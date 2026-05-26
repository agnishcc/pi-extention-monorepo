# edb-custom-provider

Custom model providers for pi.

## CrofAi

Adds CrofAi as a model provider with 22 models:
- DeepSeek V4 Pro/Flash
- Kimi K2.5/K2.6
- GLM 4.7/5/5.1
- Qwen 3.5/3.6
- Gemma 4 31B
- MiMo V2.5
- MiniMax M2.5

### Authentication

**Option 1:** Environment variable
```bash
export CROFAI_API_KEY="your-api-key"
```

**Option 2:** Auth file (`~/.pi/agent/auth.json`)
```json
{
  "crofai": { "access": "your-api-key" }
}
```

**Option 3:** Interactive login
```
/login crofai
```

### Usage

```bash
# Select CrofAi model
/model crofai/deepseek-v4-pro

# View available models
/models | grep crofai
```

### Notes

- Uses OpenAI-compatible Chat Completions API
- Supports `reasoning_effort` for reasoning-enabled models
- Vision support for `kimi-k2.5` (pass images in requests)