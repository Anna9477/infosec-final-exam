#!/usr/bin/env python3
"""
Convert Word question banks in docs/ into data/questions.json.

The script intentionally avoids third-party packages. It reads .docx files by
opening the internal Word XML directly. Legacy .doc files are supported on
Windows when Microsoft Word COM automation is available.
"""

from __future__ import annotations

import json
import re
import sys
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = ROOT / "docs"
DATA_DIR = ROOT / "data"
OUTPUT_JSON = DATA_DIR / "questions.json"
OUTPUT_JS = DATA_DIR / "questions.js"
ERROR_LOG = ROOT / "parse_errors.txt"

CHAPTER_MAP = {
    "第八章": "CH08",
    "第8章": "CH08",
    "ch08": "CH08",
    "chapter8": "CH08",
    "第九章": "CH09",
    "第9章": "CH09",
    "ch09": "CH09",
    "chapter9": "CH09",
    "第十章": "CH10",
    "第10章": "CH10",
    "ch10": "CH10",
    "chapter10": "CH10",
    "第十一章": "CH11",
    "第11章": "CH11",
    "ch11": "CH11",
    "chapter11": "CH11",
    "第十二章": "CH12",
    "第12章": "CH12",
    "ch12": "CH12",
    "chapter12": "CH12",
    "第十三章": "CH13",
    "第13章": "CH13",
    "ch13": "CH13",
    "chapter13": "CH13",
}

CHAPTER_TITLES = {
    "CH08": "第8章",
    "CH09": "第9章",
    "CH10": "第10章",
    "CH11": "第11章",
    "CH12": "第12章",
    "CH13": "第13章",
}

ANSWER_RE = re.compile(r"(?:正確)?答案\s*[:：]\s*([A-D])", re.IGNORECASE)
OPTION_RE = re.compile(r"(\(([A-D])\)|([A-D])\.)\s*", re.IGNORECASE)


@dataclass
class ParseResult:
    question: dict | None
    error: str | None = None


def normalize_text(value: str) -> str:
    value = value.replace("\u3000", " ").replace("\xa0", " ")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def chapter_from_filename(path: Path) -> str | None:
    lower_name = path.stem.lower().replace(" ", "")
    for key, chapter in CHAPTER_MAP.items():
        if key.lower() in lower_name:
            return chapter
    return None


def read_docx(path: Path) -> list[str]:
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []
    with ZipFile(path) as docx:
        xml = docx.read("word/document.xml")
    root = ET.fromstring(xml)
    for para in root.findall(".//w:p", ns):
        text = "".join(node.text or "" for node in para.findall(".//w:t", ns))
        text = normalize_text(text)
        if text:
            paragraphs.append(text)
    return paragraphs


def read_doc_with_word(path: Path) -> list[str]:
    try:
        import win32com.client  # type: ignore
    except Exception as exc:  # pragma: no cover - only available on some PCs.
        raise RuntimeError("讀取 .doc 需要 Microsoft Word 與 pywin32。") from exc

    tmp = Path(tempfile.mkdtemp()) / f"{path.stem}.txt"
    word = win32com.client.Dispatch("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    try:
        doc = word.Documents.Open(str(path))
        doc.SaveAs(str(tmp), FileFormat=2)
        doc.Close(False)
    finally:
        word.Quit()
    return [normalize_text(line) for line in tmp.read_text(encoding="utf-16", errors="ignore").splitlines() if normalize_text(line)]


def read_word_file(path: Path) -> list[str]:
    if path.suffix.lower() == ".docx":
        return read_docx(path)
    if path.suffix.lower() == ".doc":
        return read_doc_with_word(path)
    raise ValueError(f"不支援的檔案格式：{path.suffix}")


def remove_leading_number(text: str) -> str:
    return re.sub(r"^\s*\d+\s*[.、)]\s*", "", text).strip()


def parse_options(text: str) -> tuple[str, dict[str, str]]:
    matches = list(OPTION_RE.finditer(text))
    if len(matches) < 4:
        return remove_leading_number(text), {}

    question_text = remove_leading_number(text[: matches[0].start()])
    options: dict[str, str] = {}
    for index, match in enumerate(matches):
        letter = (match.group(2) or match.group(3) or "").upper()
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        option_text = text[start:end].replace("✅", "")
        option_text = ANSWER_RE.sub("", option_text)
        options[letter] = normalize_text(option_text)
    return question_text, options


def parse_block(block: str, chapter: str, order: int, source: str) -> ParseResult:
    original = normalize_text(block)
    answer_match = ANSWER_RE.search(original)
    answer = answer_match.group(1).upper() if answer_match else None
    cleaned = ANSWER_RE.sub("", original).strip()

    question_text, options = parse_options(cleaned)
    if not answer and "✅" in original:
        for letter, option_text in options.items():
            marker = re.search(rf"(?:\({letter}\)|{letter}\.)\s*.*?✅", original, re.IGNORECASE)
            if marker:
                answer = letter
                break

    if len(options) != 4:
        return ParseResult(None, f"{source} 第 {order} 題：選項解析失敗。原文：{original}")
    if answer not in options:
        return ParseResult(None, f"{source} 第 {order} 題：答案解析失敗。原文：{original}")
    if not question_text:
        return ParseResult(None, f"{source} 第 {order} 題：題目文字為空。原文：{original}")

    qid = f"{chapter}_Q{order:03d}"
    return ParseResult(
        {
            "id": qid,
            "chapter": chapter,
            "chapterTitle": CHAPTER_TITLES.get(chapter, chapter),
            "order": order,
            "question": question_text,
            "options": {letter: options[letter] for letter in ["A", "B", "C", "D"]},
            "answer": answer,
            "source": source,
        }
    )


def build_blocks(paragraphs: list[str]) -> list[str]:
    blocks: list[str] = []
    buffer: list[str] = []

    for paragraph in paragraphs:
        text = normalize_text(paragraph)
        if not text:
            continue

        if "✅" in text and len(list(OPTION_RE.finditer(text))) >= 4:
            if buffer:
                blocks.append(" ".join(buffer))
                buffer = []
            blocks.append(text)
            continue

        buffer.append(text)
        if ANSWER_RE.search(text):
            blocks.append(" ".join(buffer))
            buffer = []

    if buffer:
        blocks.append(" ".join(buffer))
    return blocks


def sort_key(path: Path) -> tuple[int, str]:
    chapter = chapter_from_filename(path) or "ZZ99"
    number = int(chapter[2:]) if chapter.startswith("CH") else 99
    return number, path.name


def convert() -> tuple[list[dict], list[str]]:
    questions: list[dict] = []
    errors: list[str] = []
    files = sorted([*DOCS_DIR.glob("*.docx"), *DOCS_DIR.glob("*.doc")], key=sort_key)

    if not files:
        return [], [f"找不到 Word 題庫檔案，請將 .doc 或 .docx 放入 {DOCS_DIR}。"]

    for file_path in files:
        chapter = chapter_from_filename(file_path)
        if not chapter:
            errors.append(f"{file_path.name}：無法從檔名判斷章節，請包含第八章～第十三章。")
            continue

        try:
            paragraphs = read_word_file(file_path)
        except Exception as exc:
            errors.append(f"{file_path.name}：讀取失敗：{exc}")
            continue

        parsed_count = 0
        for block in build_blocks(paragraphs):
            parsed_count += 1
            result = parse_block(block, chapter, parsed_count, file_path.name)
            if result.question:
                questions.append(result.question)
            elif result.error:
                errors.append(result.error)

        if parsed_count == 0:
            errors.append(f"{file_path.name}：未解析到任何題目。")

    return questions, errors


def main() -> int:
    DATA_DIR.mkdir(exist_ok=True)
    questions, errors = convert()

    payload = {
        "generatedAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "total": len(questions),
        "chapters": CHAPTER_TITLES,
        "questions": questions,
    }
    json_text = json.dumps(payload, ensure_ascii=False, indent=2)
    OUTPUT_JSON.write_text(json_text, encoding="utf-8")
    OUTPUT_JS.write_text(f"window.QUESTION_BANK = {json_text};\n", encoding="utf-8")

    if errors:
        ERROR_LOG.write_text("\n".join(errors), encoding="utf-8")
    elif ERROR_LOG.exists():
        ERROR_LOG.unlink()

    print(f"已輸出 {OUTPUT_JSON} 與 {OUTPUT_JS}，共 {len(questions)} 題。")
    if errors:
        print(f"有 {len(errors)} 筆解析警告，請查看 {ERROR_LOG}。")
    return 0 if questions else 1


if __name__ == "__main__":
    sys.exit(main())
