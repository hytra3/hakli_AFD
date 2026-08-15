FROM python:3.12-slim

# ffmpeg decodes whatever the browser recorded (webm/opus, m4a, wav, amr)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Bake the model into the image so cold starts don't wait on a 1 GB download.
# (Comment out to fetch weights at first run instead.)
RUN python -c "from transformers import Wav2Vec2Model; Wav2Vec2Model.from_pretrained('facebook/mms-300m')"

ENV EMBED_LAYER=12
# Cloud Run sets $PORT (usually 8080)
CMD exec uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1
