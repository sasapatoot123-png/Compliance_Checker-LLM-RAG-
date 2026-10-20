# 🛡️ ISO 27001 Compliance Checker

An AI-powered tool that evaluates company documentation against ISO 27001 requirements using Python, semantic search, NLP, and LLMs. It identifies potential compliance gaps and generates structured reports with evidence and recommended fixes.

## ✨ Features

- **Automated Compliance Assessment:** Classifies requirements as Compliant, Partially Compliant, or Not Compliant.
- **Semantic Search:** Uses Sentence Transformers and keyword matching to retrieve relevant evidence from company PDF documents.
- **AI-Powered Analysis:** Uses Llama 3 (8B) through Ollama to evaluate evidence and explain compliance gaps.
- **Evidence Traceability:** Includes supporting text and page references where applicable.
- **Actionable Recommendations:** Generates practical fixes for identified gaps.
- **Automated Reporting:** Exports detailed CSV and HTML compliance reports.
- **Overall Compliance Score:** Calculates an estimated compliance percentage.

## 🛠️ Technologies

- Python
- Pandas & NumPy
- PyMuPDF
- Sentence Transformers (`all-MiniLM-L6-v2`)
- Llama 3 (8B)
- Ollama
- NLP & Semantic Search
- Jupyter Notebook

## ⚙️ Requirements

- Python 3.10 or compatible version
- Jupyter Notebook
- Ollama installed locally
- Llama 3 (8B) model
- ISO 27001 requirements in CSV format
- Company documentation in PDF format

## 🚀 Installation & Usage

### 1. Clone the repository

```bash
git clone <your-repository-url>
cd <your-repository-folder>
```

### 2. Install dependencies

```bash
pip install pandas numpy pymupdf requests sentence-transformers
```

### 3. Install and start Ollama

Download Ollama from https://ollama.com/

Pull the required model:

```bash
ollama pull llama3:8b
```

Start the Ollama service:

```bash
ollama serve
```

### 4. Configure input files

Open `ISO27001_Compliance_Checker.ipynb` and update the file paths for:

- `ISO_CSV`: ISO 27001 requirements CSV file.
- `COMPANY_PDF`: Company documentation PDF file.

### 5. Run the notebook

Open the notebook in Jupyter and execute the cells sequentially to assess the requirements and generate the reports.

## 📊 Output Reports

The system generates two reports:

- `iso27001_compliance_report.csv`
- `iso27001_compliance_report.html`

Each report includes requirement IDs, compliance status, explanations, supporting evidence, page references where available, and recommended fixes.

## 🔍 Compliance Scoring

- **Compliant:** 1.0 point
- **Partially Compliant:** 0.5 points
- **Not Compliant:** 0 points

The overall compliance percentage is calculated from the average requirement score.

## ⚠️ Limitations

- Scanned PDFs without selectable text require OCR preprocessing.
- Results depend on document quality, evidence retrieval, and LLM analysis.
- Evidence matches and compliance scores are preliminary indicators, not proof of actual organizational compliance.
- Human review is required before making compliance or audit decisions.

## 🎯 Project Objective

To simplify preliminary ISO 27001 compliance reviews, improve evidence traceability, identify documentation gaps, and provide actionable recommendations through AI-assisted analysis.

**Disclaimer:** This tool supports compliance assessment but does not replace professional auditing or official ISO 27001 certification.
