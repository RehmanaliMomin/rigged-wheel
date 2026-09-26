---
title: Rigged Wheel x Laya
emoji: 🎡
colorFrom: red
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
short_description: Decides if a wheel question is praise or blame
---

# Rigged Wheel × Laya

The praise-or-blame API behind [The Totally Fair Wheel](https://rehmanalimomin.github.io/rigged-wheel/).
It asks [Laya](https://huggingface.co/convaiinnovations/laya) whether being the answer to a question
is a good thing (the wheel lands on whoever gets the credit) or a bad thing (it lands on whoever gets the blame).

```bash
curl -s http://127.0.0.1:7860/classify \
  -H 'content-type: application/json' \
  -d '{"question": "Who makes more mistakes?"}'
# {"p_credit": 0.1529, "verdict": "blame", "ms": 31}
```

- **On a Mac:** `NGROK_DOMAIN=your-name.ngrok-free.app ./host-on-mac.sh`
- **Anywhere with Docker and about 3 GB of RAM:** `docker build -t laya-api . && docker run -p 7860:7860 laya-api`
  (the header at the top of this file makes it deployable as a Hugging Face Docker Space, which needs PRO)
