#!/usr/bin/env bash
# 커넥톰 원본 데이터를 받는다 (~135MB). 저장소에는 가공본만 들어간다.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw && cd data/raw
curl -fL# -o completeness_783.csv \
  https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/main/Completeness_783.csv
curl -fL# -o connectivity_783.parquet \
  https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/main/Connectivity_783.parquet
curl -fL# -o annotations_783.tsv \
  https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv
echo "완료. 이제 tools/pack.py 와 tools/meta.py 를 실행하세요."
