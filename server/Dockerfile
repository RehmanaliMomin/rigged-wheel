FROM python:3.12-slim

RUN useradd -m -u 1000 user
USER user
ENV PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=2 \
    LAYA_THREADS=2
WORKDIR /home/user/app

# CPU-only torch first so laya doesn't pull the much larger CUDA build.
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir --user -r requirements.txt

# Bake the English checkpoint into the image so cold starts skip the download.
RUN python -c "from laya import Router; Router().predict('warm up', {'v': {'type': 'choice', 'instructions': 'ok?', 'criteria': {'A': 'yes', 'B': 'no'}}}, model='english')"

COPY --chown=user app.py .
EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
