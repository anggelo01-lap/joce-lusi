import os, re
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from dotenv import load_dotenv
import requests

load_dotenv()
app = FastAPI(title="ORIÓN API - PlatinumVIP", version="1.0")

class ChatIn(BaseModel):
    texto: str
    contexto: dict = {}

class SpeakIn(BaseModel):
    texto: str

CATEGORIAS = {"van": ["van", "minivan", "grupo", "familia"], "suv": ["suv", "camioneta"], "sedan": ["sedan", "sedán", "auto", "taxi"]}

def extraer_datos(texto: str, previo: dict) -> dict:
    """Extrae origen, destino, categoria y telefono del texto sin inventar datos."""
    datos = dict(previo or {})
    t = texto.strip()
    low = t.lower()
    m = re.search(r"(?:desde|de|recojo en|recojo|estoy en)\s+(.+?)\s+(?:hasta|hacia|a|al|para ir a)\s+(.+)$", t, re.I)
    if m:
        datos["origen"], datos["destino"] = m.group(1).strip(" ,."), m.group(2).strip(" ,.")
    else:
        m = re.search(r"(?:destino|voy a|ir a|llevar(?:me)? a)\s*:?\s*(.+)$", t, re.I)
        if m:
            datos["destino"] = m.group(1).strip(" ,.")
        m = re.search(r"(?:origen|recojo|recógeme en|estoy en|desde)\s*:?\s*(.+?)(?:\s+(?:hasta|hacia)\s+.+)?$", t, re.I)
        if m and "origen" not in datos:
            datos["origen"] = m.group(1).strip(" ,.")
    if "aeropuerto" in low and "destino" not in datos and "origen" not in datos:
        datos["destino"] = "Aeropuerto de Trujillo"
    for campo in ("origen", "destino"):
        if datos.get(campo):
            datos[campo] = re.sub(r"\s+(?:en|con)\s+(?:una\s+|un\s+)?(?:van|suv|sedan|sedán|camioneta)\s*$", "", datos[campo], flags=re.I)
            datos[campo] = re.sub(r"^(?:el|la)\s+(?=aeropuerto)", "", datos[campo], flags=re.I).capitalize() if datos[campo].lower().startswith(("el aeropuerto","la aeropuerto")) else datos[campo]
    for cat, palabras in CATEGORIAS.items():
        if any(re.search(rf"\b{p}\b", low) for p in palabras):
            datos["categoria"] = cat
            break
    tel = re.search(r"(\+?51)?\s?9\d{2}[\s-]?\d{3}[\s-]?\d{3}", t)
    if tel:
        datos["telefono"] = re.sub(r"[\s-]", "", tel.group(0))
    n = re.search(r"(?:me llamo|soy|mi nombre es)\s+([A-Za-zÁÉÍÓÚáéíóúñÑ ]{2,60})", t, re.I)
    if n:
        datos["nombre"] = n.group(1).strip().title()
    return datos

def respuesta_operadora(texto: str, datos: dict) -> str:
    low = texto.lower().strip()
    falta = [c for c in ("origen", "destino") if not datos.get(c)]
    if any(x in low for x in ["hola", "buenos días", "buenas tardes", "buenas noches"]) and len(falta) == 2:
        return "Hola. Soy Orión, asistente virtual de Platinum VIP. Indíqueme su punto de recojo y destino."
    if falta == ["origen", "destino"]:
        return "Con gusto. Para registrar el servicio necesito su punto de recojo y su destino."
    if falta == ["origen"]:
        return f"Destino anotado: {datos['destino']}. ¿Desde dónde lo recogemos?"
    if falta == ["destino"]:
        return f"Recojo anotado: {datos['origen']}. ¿A dónde desea ir?"
    if not datos.get("telefono"):
        return f"Tengo recojo en {datos['origen']} y destino {datos['destino']}. ¿Me confirma un teléfono de contacto?"
    return f"Solicitud completa: {datos['origen']} → {datos['destino']} ({datos.get('categoria', 'sedan')}). La operadora puede registrarla como servicio."

@app.get("/")
def root():
    return {"assistant":"ORIÓN","status":"online","mode":"operadora"}

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/api/chat")
def chat(data: ChatIn):
    datos = extraer_datos(data.texto, (data.contexto or {}).get("datos", {}))
    listo = bool(datos.get("origen") and datos.get("destino") and datos.get("telefono"))
    return {"respuesta": respuesta_operadora(data.texto, datos), "texto_recibido": data.texto, "datos": datos, "listo": listo}

@app.post("/api/speak")
def speak(data: SpeakIn):
    api_key = os.getenv("ELEVENLABS_API_KEY")
    voice_id = os.getenv("ELEVENLABS_VOICE_ID")
    model_id = os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")
    if not api_key or not voice_id:
        raise HTTPException(503, "Configura ELEVENLABS_API_KEY y ELEVENLABS_VOICE_ID")
    r = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        headers={"xi-api-key": api_key, "Content-Type":"application/json", "Accept":"audio/mpeg"},
        json={"text":data.texto,"model_id":model_id},
        timeout=30
    )
    if not r.ok:
        raise HTTPException(r.status_code, r.text[:500])
    return Response(content=r.content, media_type="audio/mpeg")
