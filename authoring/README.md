# Offline Scenario Authoring

这里的工具只用于离线内容生产，不被 Web server 引用，也不提供在线 API。

```bash
python3 authoring/scenario_pipeline.py generate \
  --input /path/to/candidate-batch.json \
  --output-dir /tmp/drafts \
  --run-output /tmp/authoring-run.json

python3 authoring/scenario_pipeline.py validate \
  --input authoring/examples/demo-candidate.json \
  --output-scenario /tmp/demo.validated.json \
  --output-report /tmp/demo.validation.json \
  --wolfram

python3 authoring/scenario_pipeline.py approve \
  --scenario /tmp/demo.validated.json \
  --report /tmp/demo.validation.json \
  --reviewer teacher@example.com \
  --output /tmp/demo.approved.json

python3 authoring/scenario_pipeline.py publish \
  --scenarios /tmp/demo.approved.json \
  --reports /tmp/demo.validation.json \
  --version 2026-08-07 \
  --output /tmp/scenario-bank.json
```

`generate` 把 engine-specific candidate batch 归一化为 `draft` records，并生成
`AuthoringRun`。`validate` 默认执行 schema 边界与确定性检查；加 `--wolfram` 后会调用
`wolframscript`，并对 `metadata.wolframChecks` 中的 Wolfram Language 布尔表达式
逐项校验。没有声明数学检查时会 fail closed。`approve` 是独立的人工审批动作，
`publish` 只接收 `approved` 记录。
