const express = require('express');
const router = express.Router();
const analyticsService = require('../services/azure-analytics.service');

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, message) => Object.assign(new Error(message), { status });
const id = v => Number.isSafeInteger(Number(v)) && Number(v) > 0;

/**
 * GET /api/analisis/dashboard
 * Retorna métricas analíticas calculadas con Azure AI
 */
router.get('/dashboard', wrap(async (_req, res) => {
  const data = await analyticsService.obtenerAnalisisDashboard();
  res.json(data);
}));

/**
 * POST /api/analisis/generar-resumen-ia
 * Invoca Azure OpenAI para un diagnóstico ejecutivo en lenguaje natural
 */
router.post('/generar-resumen-ia', wrap(async (req, res) => {
  const prompt = req.body?.prompt;
  const resultado = await analyticsService.generarAnalisisConAzureAI(prompt);
  res.json(resultado);
}));

/**
 * POST /api/analisis/analizar-llamada/:id
 * Procesa la conversación telefónica con IA para obtener CSAT, sentimiento y resumen
 */
router.post('/analizar-llamada/:id', wrap(async (req, res) => {
  if (!id(req.params.id)) throw fail(400, 'Identificador de llamada inválido.');
  const resultado = await analyticsService.analizarLlamadaIndividual(req.params.id);
  res.json(resultado);
}));

module.exports = router;
