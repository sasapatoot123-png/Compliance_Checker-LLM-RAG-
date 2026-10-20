import ast
import json
import os
import socket
import sys
import tempfile
import threading
import uuid
import webbrowser

import pandas as pd
import requests
from flask import Flask, Response, jsonify, request, send_from_directory

BASE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(BASE, "frontend")
NOTEBOOK = os.path.join(BASE, "ISO27001_Compliance_Checker.ipynb")
DEFAULT_CSV = os.path.join(BASE, "iso-27001-annex-a.csv")
OLLAMA_TAGS = "http://localhost:11434/api/tags"
DEFAULT_MODEL = "llama3:8b"
REQUIRED = ["build_index", "search_index", "load_requirements", "check_requirement", "build_html", "call_llm"]


def load_notebook(path):
    with open(path, encoding="utf-8") as f:
        nb = json.load(f)

    body = []
    for cell in nb["cells"]:
        if cell["cell_type"] != "code":
            continue
        src = "".join(cell["source"])
        if src.lstrip().startswith(("!", "%")):
            continue
        for node in ast.parse(src).body:
            if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef)):
                body.append(node)
            elif isinstance(node, ast.Assign):
                try:
                    ast.literal_eval(node.value)
                    body.append(node)
                except (ValueError, TypeError, SyntaxError):
                    pass

    ns = {"__name__": "notebook"}
    exec(compile(ast.Module(body=body, type_ignores=[]), path, "exec"), ns)

    missing = [n for n in REQUIRED if n not in ns]
    if missing:
        raise RuntimeError("The notebook is missing these functions: " + ", ".join(missing))

    print("Loading embedding model (first run downloads ~90 MB)...")
    ns["embedder"] = ns["SentenceTransformer"]("all-MiniLM-L6-v2")
    ns["company_index"] = None
    return ns


try:
    nbns = load_notebook(NOTEBOOK)
except ImportError as e:
    sys.exit(f"\nMissing package: {e}\nInstall everything with:  pip install -r requirements.txt\n")
except FileNotFoundError:
    sys.exit(f"\nNotebook not found: {NOTEBOOK}\nKeep ISO27001_Compliance_Checker.ipynb next to server.py\n")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 60 * 1024 * 1024

lock = threading.Lock()


def new_job():
    return {"state": "idle", "run_id": None, "results": [], "done": 0, "total": 0,
            "current": "", "error": "", "cancel": False}


state = {"pdf": None, "index": None, "csv": None, "requirements": None, "job": new_job()}

POINTS = {"COMPLIANT": 1.0, "PARTIAL": 0.5, "NOT_COMPLIANT": 0.0, "UNKNOWN": 0.0}


def compliance_pct(results):
    if not results:
        return 0.0
    return 100 * sum(POINTS.get(r["Verdict"], 0.0) for r in results) / len(results)


def make_df(results):
    df = pd.DataFrame(results)
    df["Page"] = df["Page"].astype("Int64")
    return df


def friendly(e):
    if isinstance(e, requests.ConnectionError):
        return "Ollama is not running. Start it with: ollama serve"
    return str(e)


def run_job(job, index, reqs, model):
    try:
        nbns["MODEL"] = model
        nbns["company_index"] = index
        for i, req in enumerate(reqs):
            if job["cancel"]:
                job["state"] = "cancelled"
                return
            job["current"] = f"{req[0]} {req[1]}"
            res = nbns["check_requirement"](*req)
            with lock:
                job["results"].append(res)
                job["done"] = i + 1
        job["current"] = ""
        job["state"] = "done"
    except Exception as e:
        job["error"] = friendly(e)
        job["state"] = "error"


def try_load_default_csv():
    if state["requirements"] is None and os.path.exists(DEFAULT_CSV):
        try:
            df = pd.read_csv(DEFAULT_CSV, encoding="utf-8-sig")
            reqs, _ = nbns["load_requirements"](df)
            state["requirements"] = reqs
            state["csv"] = {"name": os.path.basename(DEFAULT_CSV), "count": len(reqs)}
        except Exception:
            pass


def ollama_models():
    try:
        r = requests.get(OLLAMA_TAGS, timeout=3)
        return True, [m["name"] for m in r.json().get("models", [])]
    except Exception:
        return False, []


def error(msg, code=400):
    return jsonify(error=msg), code


@app.route("/")
def home():
    return send_from_directory(FRONTEND, "index.html")


@app.route("/style.css")
def css():
    return send_from_directory(FRONTEND, "style.css")


@app.route("/app.js")
def js():
    return send_from_directory(FRONTEND, "app.js")


@app.route("/api/state")
def api_state():
    try_load_default_csv()
    ok, models = ollama_models()
    job = state["job"]
    return jsonify(ollama=ok, models=models, pdf=state["pdf"], csv=state["csv"],
                   job={"state": job["state"], "run_id": job["run_id"]})


@app.route("/api/upload", methods=["POST"])
def api_upload():
    f = request.files.get("pdf")
    if not f:
        return error("No PDF received.")

    fd, path = tempfile.mkstemp(suffix=".pdf")
    os.close(fd)
    try:
        f.save(path)
        pages = len(nbns["fitz"].open(path))
        index = nbns["build_index"](path)
    except ValueError as e:
        return error(str(e))
    except Exception:
        return error("Could not read this file as a PDF.")
    finally:
        try:
            os.remove(path)
        except OSError:
            pass

    with lock:
        state["index"] = index
        state["pdf"] = {"name": f.filename, "pages": pages, "chunks": len(index["chunks"])}
    return jsonify(state["pdf"])


@app.route("/api/upload_csv", methods=["POST"])
def api_upload_csv():
    f = request.files.get("csv")
    if not f:
        return error("No CSV received.")
    try:
        reqs, _ = nbns["load_requirements"](pd.read_csv(f.stream, encoding="utf-8-sig"))
    except ValueError as e:
        return error(str(e))
    except Exception:
        return error("Could not read this file as a CSV.")
    with lock:
        state["requirements"] = reqs
        state["csv"] = {"name": f.filename, "count": len(reqs)}
    return jsonify(state["csv"])


@app.route("/api/run", methods=["POST"])
def api_run():
    with lock:
        if state["job"]["state"] == "running":
            return error("A check is already running.", 409)
        if state["index"] is None:
            return error("Please upload the company PDF first.")
        if state["requirements"] is None:
            return error("Please choose the ISO 27001 requirements CSV.")
        model = ((request.get_json(silent=True) or {}).get("model") or "").strip() or DEFAULT_MODEL
        reqs = state["requirements"]
        job = new_job()
        job.update(state="running", run_id=uuid.uuid4().hex, total=len(reqs))
        state["job"] = job
        index = state["index"]
    threading.Thread(target=run_job, args=(job, index, reqs, model), daemon=True).start()
    return jsonify(run_id=job["run_id"], total=job["total"])


@app.route("/api/status")
def api_status():
    job = state["job"]
    since = request.args.get("since", 0, type=int)
    with lock:
        results = list(job["results"][since:])
        done = job["done"]
    return jsonify(run_id=job["run_id"], state=job["state"], done=done, total=job["total"],
                   current=job["current"], error=job["error"], results=results)


@app.route("/api/reset", methods=["POST"])
def api_reset():
    with lock:
        state["job"]["cancel"] = True
        state["job"] = new_job()
    return jsonify(ok=True)


def current_results():
    with lock:
        return list(state["job"]["results"])


@app.route("/api/report.csv")
def report_csv():
    results = current_results()
    if not results:
        return error("No results yet.", 404)
    data = make_df(results).to_csv(index=False, encoding="utf-8-sig")
    return Response("\ufeff" + data, mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=iso27001_compliance_report.csv"})


@app.route("/api/report.html")
def report_html():
    results = current_results()
    if not results:
        return error("No results yet.", 404)
    page = nbns["build_html"](make_df(results), compliance_pct(results))
    return Response(page, mimetype="text/html",
                    headers={"Content-Disposition": "attachment; filename=iso27001_compliance_report.html"})


def free_port(start):
    for port in range(start, start + 20):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start


if __name__ == "__main__":
    port = int(os.environ.get("PORT", free_port(5000)))
    url = f"http://127.0.0.1:{port}"
    print(f"\nLex Align is running at {url}\nDo not open index.html directly; use the address above.\n")
    threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=port, threaded=True)
