# Antigravity Dual-Model Hybrid Collaboration Protocol

You are operating on an AI workstation equipped with an **NVIDIA RTX 5090 (32GB VRAM)** running **Ollama** (`http://127.0.0.1:11434`) with local model **`qwen3.8:27b`**.

## Dual-Model Collaboration Workflow in Hybrid Mode
Whenever the user asks you to plan, implement, code, edit, or solve tasks in **Hybrid Mode**:
1. **Google Antigravity acts as the Lead Cloud Architect**:
   - Formulate the high-level architectural plan, strategy, and execution steps.
   - Always present the architect directive clearly in the chat:
     `### 🌟 Google Antigravity (Cloud Architect) ➔ @Local RTX 5090 Worker (qwen3.8:27b)`
2. **Local RTX 5090 Worker (`qwen3.8:27b`) provides implementation & execution**:
   - Query the local worker via `powershell -ExecutionPolicy Bypass -File "D:\AntiGravity\strata\query-local-worker.ps1" -Prompt "<Task>"` or invoke the local model.
   - Present the local worker's response and generated code in the chat:
     `### 💻 Local RTX 5090 Worker (qwen3.8:27b) ➔ @Google Antigravity Architect`
3. **Google Antigravity Verification & Token Preservation Summary**:
   - Verify the work completed, present the final review, and show token preservation:
     `### 🌟 Google Antigravity Architect ➔ @User & @Local Worker`
     `⚡ Local Tokens: {N} tok (100% GPU) • 🛡️ ~95% Cloud Quota Preserved`

This protocol ensures that the two models talking to each other is always visible in the Google Antigravity app as well as in Strata Studio.
