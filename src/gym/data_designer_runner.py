"""Generate one structured forge document per Data Designer seed row.

The caller supplies only abstract capability topics. The original benchmark task,
criteria, answers, and source documents never cross this process boundary.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import data_designer.config as dd
from data_designer.config.seed_source_dataframe import DataFrameSeedSource
from data_designer.interface import DataDesigner


def parse_document(raw: object, topic_name: str) -> dict:
    if not isinstance(raw, str):
        raise ValueError("Data Designer returned a non-text document.")
    candidate = raw.strip()
    if "```" in candidate:
        candidate = candidate.split("```", 1)[1]
        candidate = candidate.removeprefix("json").strip()
    document = json.loads(candidate)
    if isinstance(document, dict) and isinstance(document.get("documents"), list):
        if len(document["documents"]) != 1:
            raise ValueError("Data Designer returned a document wrapper with the wrong length.")
        document = document["documents"][0]
    if not isinstance(document, dict):
        raise ValueError("Data Designer returned a JSON document that is not an object.")
    if document.get("topic_name") != topic_name:
        document["topic_name"] = topic_name
    required = ("topic_name", "title", "document_type", "content", "task_instruction", "reference_answer", "verifier_targets")
    if any(not document.get(field) for field in required) or not isinstance(document["verifier_targets"], list):
        raise ValueError("Data Designer returned a document with missing required fields.")
    return document


def main() -> None:
    request = json.load(sys.stdin)
    provider = request["provider"]
    topics = request["topics"]
    rows = []
    for topic in topics:
        for _ in range(int(topic["remaining"])):
            rows.append(
                {
                    "topic_name": topic["name"],
                    "topic_description": topic["description"],
                    "verifier_strategy": topic["verifierStrategy"],
                }
            )
    if not rows:
        raise ValueError("Data Designer received no document rows.")

    model_provider = dd.ModelProvider(
        name="recursive-provider",
        endpoint=provider["baseUrl"],
        provider_type="openai",
        api_key=provider["apiKey"],
    )
    model = dd.ModelConfig(
        alias="recursive-generator",
        model=provider["model"],
        provider="recursive-provider",
        inference_parameters=dd.ChatCompletionInferenceParams(
            temperature=0.7,
            max_tokens=24000,
            timeout=180,
            max_parallel_requests=4,
        ),
    )
    builder = dd.DataDesignerConfigBuilder(model_configs=[model]).with_seed_dataset(
        DataFrameSeedSource(df=pd.DataFrame(rows))
    )
    builder.add_column(
        dd.LLMTextColumnConfig(
            name="document_json",
            model_alias="recursive-generator",
            system_prompt=(
                request["prompt"]
                + "\n\nData Designer is invoking you once per seed row. Return exactly one document object, "
                "not a documents wrapper or an array. The topic_name must exactly match the seed row."
            ),
            prompt=(
                "Create one genuinely novel synthetic training document for this abstract capability. "
                "Return only a JSON object with exactly these fields: topic_name, title, document_type, "
                "content, task_instruction, reference_answer, verifier_targets. "
                "Invent fresh parties, dates, figures, jurisdictions, facts, and document structure. "
                "Do not mention or reconstruct any benchmark source. "
                "Topic: {{ topic_name }}\n"
                "Capability description: {{ topic_description }}\n"
                "Verifier strategy: {{ verifier_strategy }}"
            ),
        )
    )

    artifact_path = Path(request["artifactPath"])
    designer = DataDesigner(
        artifact_path=artifact_path,
        model_providers=[model_provider],
        auto_configure_logging=False,
    )
    result = designer.create(
        builder,
        num_records=len(rows),
        dataset_name="documents",
        artifact_path=artifact_path,
    )
    dataset = result.load_dataset()
    documents = []
    errors = []
    for _, row in dataset.iterrows():
        try:
            documents.append(parse_document(row["document_json"], str(row["topic_name"])))
        except Exception as error:
            errors.append(f"{row['topic_name']}: {type(error).__name__}: {error}")
    print(json.dumps({"documents": documents, "errors": errors}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        raise
