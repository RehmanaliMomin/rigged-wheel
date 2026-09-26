"""Tiny API that asks Laya whether a wheel question is praise or blame.

POST /classify {"question": "Who makes more mistakes?"}
  -> {"p_credit": 0.06, "verdict": "blame", "ms": 31}
"""

import threading
import time
from contextlib import asynccontextmanager
from functools import lru_cache

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from laya import Router
from pydantic import BaseModel, Field

MODEL = "english"
# Two neutral option keys, as the Laya docs recommend for yes/no style decisions.
# Picked after comparing four wordings on 46 labelled questions (43/46 correct).
DECISION = {
    "type": "choice",
    "instructions": "A couple spins a wheel to answer this question. "
    "Is being picked as the answer a good thing or a bad thing for that person?",
    "criteria": {
        "A": "good: you are right, win, are better, smarter or trusted, get praise or a privilege",
        "B": "bad: you are wrong, lose, are worse, at fault, messed up, have a bad habit, or get a chore",
    },
}

router = Router()
lock = threading.Lock()  # one forward pass at a time on the small CPU box


@lru_cache(maxsize=4096)
def p_credit(question: str) -> float:
    with lock:
        answer = router.predict(question, {"v": DECISION}, model=MODEL)["answers"]["v"]
    return float(answer["probabilities"]["A"])


@asynccontextmanager
async def lifespan(_app):
    p_credit("Who is always right?")  # load the checkpoint before taking traffic
    yield


app = FastAPI(title="Rigged Wheel x Laya", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://rehmanalimomin.github.io"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST"],
    allow_headers=["content-type", "ngrok-skip-browser-warning"],
    max_age=86400,
)


class ClassifyRequest(BaseModel):
    question: str = Field(min_length=1, max_length=120)


@app.get("/")
def health():
    return {"ok": True, "model": "convaiinnovations/laya", "checkpoint": MODEL}


@app.post("/classify")
def classify(req: ClassifyRequest):
    started = time.perf_counter()
    p = p_credit(" ".join(req.question.split()))
    return {
        "p_credit": round(p, 4),
        "verdict": "credit" if p >= 0.5 else "blame",
        "ms": round((time.perf_counter() - started) * 1000),
    }
