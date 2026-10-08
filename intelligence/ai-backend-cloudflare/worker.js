const MAX_BODY_BYTES = 16 * 1024;
const MAX_QUESTION_CHARS = 4000;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const MAX_LIBRARY_CHARS = 45_000;

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin,
      "vary": "Origin"
    }
  });
}

function corsPreflight(origin) {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      "vary": "Origin"
    }
  });
}

function clientBucket(request) {
  const forwarded = request.headers.get("CF-Connecting-IP");
  return forwarded || "anonymous";
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function normalizeSources(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item.title === "string" && typeof item.url === "string")
    .slice(0, 8)
    .map((item) => ({ title: item.title, url: item.url }));
}

function isAnalyticsQuestion(question) {
  return /(аналитик|посещ|визит|просмотр|сесс|трафик|bounce|отказ|страниц|аудитор|конверс|метрик|статистик|сайт.*(сейчас|недел|месяц)|сейчас.*сайт)/i.test(question);
}

async function loadWebAnalytics(env) {
  if (!env.POSTHOG_HOST || !env.POSTHOG_PROJECT_ID || !env.POSTHOG_API_KEY) {
    return { configured: false };
  }

  const host = env.POSTHOG_HOST.replace(/\/$/, "");
  const response = await fetch(
    `${host}/api/projects/${encodeURIComponent(env.POSTHOG_PROJECT_ID)}/query/`,
    {
      method: "POST",
      headers: {
        "authorization": `Bearer ${env.POSTHOG_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        query: {
          kind: "WebOverviewQuery",
          dateRange: { date_from: "-7d" }
        }
      })
    }
  );

  if (!response.ok) return { configured: true, available: false };
  const data = await response.json();
  return { configured: true, available: true, data };
}

async function loadJson(url) {
  const response = await fetch(url, {
    headers: { "accept": "application/json" },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  if (!response.ok) throw new Error("library_unavailable");
  return response.json();
}

function boundedJson(value) {
  const serialized = JSON.stringify(value);
  if (serialized.length <= MAX_LIBRARY_CHARS) return serialized;
  return serialized.slice(0, MAX_LIBRARY_CHARS) + "\n[контекст ограничен по размеру]";
}

async function loadLibraryBundle(env) {
  const entries = {
    knowledge: env.KNOWLEDGE_URL,
    institutional_registry: env.INSTITUTIONAL_REGISTRY_URL,
    projects: env.PROJECTS_URL,
    platform_graph: env.PLATFORM_GRAPH_URL,
    intelligence_config: env.INTELLIGENCE_CONFIG_URL,
    tool_registry: env.TOOL_REGISTRY_URL
  };

  const results = await Promise.all(
    Object.entries(entries).map(async ([key, url]) => {
      try {
        return [key, await loadJson(url), true];
      } catch {
        return [key, null, false];
      }
    })
  );

  const bundle = {};
  const status = {};
  for (const [key, value, available] of results) {
    status[key] = available;
    if (available) bundle[key] = boundedJson(value);
  }

  if (!status.knowledge) throw new Error("knowledge_unavailable");
  return { bundle, status };
}

export class RateLimiter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const now = Date.now();
    const current = (await this.state.storage.get("bucket")) || { startedAt: now, count: 0 };
    const bucket = now - current.startedAt >= RATE_WINDOW_MS
      ? { startedAt: now, count: 0 }
      : current;

    if (bucket.count >= RATE_LIMIT) {
      return new Response("rate_limited", { status: 429 });
    }

    bucket.count += 1;
    await this.state.storage.put("bucket", bucket);
    return new Response("ok", { status: 200 });
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "";

    if (origin !== allowedOrigin) {
      return json({ error: "origin_not_allowed" }, 403, allowedOrigin);
    }

    if (request.method === "OPTIONS") {
      return corsPreflight(allowedOrigin);
    }

    const url = new URL(request.url);
    if (url.pathname !== "/v1/ask" || request.method !== "POST") {
      return json({ error: "not_found" }, 404, allowedOrigin);
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413, allowedOrigin);
    }

    const limiterId = env.RATE_LIMITER.idFromName(clientBucket(request));
    const limiter = env.RATE_LIMITER.get(limiterId);
    const limitResponse = await limiter.fetch("https://rate-limit.local/check");
    if (!limitResponse.ok) {
      return json({ error: "rate_limited" }, 429, allowedOrigin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, 400, allowedOrigin);
    }

    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question || question.length > MAX_QUESTION_CHARS) {
      return json({ error: "invalid_question" }, 400, allowedOrigin);
    }

    if (!env.OPENAI_API_KEY) {
      return json({ error: "backend_not_configured" }, 503, allowedOrigin);
    }
    if (!env.OPENAI_MODEL || env.OPENAI_MODEL === "SET_IN_CLOUDFLARE_RUNTIME") {
      return json({ error: "model_not_configured" }, 503, allowedOrigin);
    }

    let library;
    try {
      library = await loadLibraryBundle(env);
    } catch {
      return json({ error: "knowledge_unavailable" }, 503, allowedOrigin);
    }

    let analytics = null;
    if (isAnalyticsQuestion(question)) {
      try {
        analytics = await loadWebAnalytics(env);
      } catch {
        analytics = { configured: true, available: false };
      }
    }

    const system = [
      "Ты — ЖАК, публичный AI-ассистент сайта жакин.рф.",
      "Ты работаешь не только как FAQ сайта: для ответа используй подключённую библиотеку знаний, институциональный реестр, проекты, граф платформы, конфигурацию Intelligence и реестр инструментов.",
      "Режимы: 1) вопросы о Жакин.рф — приоритет библиотеке сайта; 2) аналитика сайта — используй только переданные серверные метрики; 3) общие вопросы — используй общие знания и объясняй темы по экономике, международным процессам, безопасности, технологиям, ИИ и другим областям.",
      "Библиотека является источником контекста, но не разрешает выдумывать отсутствующие факты.",
      "Инструменты, отмеченные в реестре как agent_side_integrations, доступны проектному агенту, но НЕ являются прямым runtime-доступом ЖАК. Никогда не утверждай обратное.",
      "Если вопрос требует актуальной информации, которой нет в переданном контексте или аналитике, честно укажи ограничение.",
      "Если данных недостаточно, прямо скажи об этом.",
      "Не раскрывай закрытые, персональные, секретные или непроверенные сведения.",
      "Верни JSON с полями answer и sources.",
      "sources — массив объектов {title,url}; для вопросов о сайте используй только источники из предоставленного публичного контура. Не придумывай URL.",
      "",
      "ПОДКЛЮЧЁННАЯ БИБЛИОТЕКА:",
      JSON.stringify(library.bundle),
      "",
      "СТАТУС БИБЛИОТЕКИ:",
      JSON.stringify(library.status),
      "",
      "АНАЛИТИКА САЙТА:",
      analytics
        ? JSON.stringify(analytics)
        : "Для этого вопроса аналитические данные не запрашивались.",
      "Если аналитика запрошена и доступна, используй только переданные значения и указывай период (последние 7 дней).",
      "Если analytics.configured=false или analytics.available=false, честно сообщи, что серверный аналитический источник пока не подключён или недоступен."
    ].join("\n");

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        input: [
          { role: "system", content: [{ type: "input_text", text: system }] },
          { role: "user", content: [{ type: "input_text", text: question }] }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "zhak_answer",
            strict: true,
            schema: {
              type: "object",
              properties: {
                answer: { type: "string" },
                sources: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      url: { type: "string" }
                    },
                    required: ["title", "url"],
                    additionalProperties: false
                  }
                }
              },
              required: ["answer", "sources"],
              additionalProperties: false
            }
          }
        }
      })
    });

    if (!openaiResponse.ok) {
      return json({ error: "upstream_ai_error" }, 502, allowedOrigin);
    }

    const payload = await openaiResponse.json();
    const text = extractOutputText(payload);

    try {
      const parsed = JSON.parse(text);
      return json({
        answer: typeof parsed.answer === "string" ? parsed.answer : "",
        sources: normalizeSources(parsed.sources)
      }, 200, allowedOrigin);
    } catch {
      return json({ error: "invalid_ai_response" }, 502, allowedOrigin);
    }
  }
};
