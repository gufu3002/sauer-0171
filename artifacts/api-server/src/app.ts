import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import onFinished from "on-finished";
import router from "./routes";
import proxyRouter from "./routes/proxy";
import claudeRouter from "./routes/claude";
import geminiNativeRouter from "./routes/gemini-native";
import imagesRouter from "./routes/proxy-images";
import logsRouter, { pushLog } from "./routes/logs";
import usageLogsRouter from "./routes/usage-logs";
import billingRouter from "./routes/billing";
import { logger } from "./lib/logger";

const app: Express = express();
app.set("etag", false);

import { getConfig, updateConfig, type SettingsConfig } from "./config";

export type UrlAutoCorrectConfig = SettingsConfig["urlAutoCorrect"];

export function getUrlAutoCorrect(): UrlAutoCorrectConfig {
  return { ...getConfig().settings.urlAutoCorrect };
}

export async function setUrlAutoCorrect(updates: Partial<UrlAutoCorrectConfig>): Promise<void> {
  const currentSettings = getConfig().settings;
  await updateConfig({
    settings: {
      ...currentSettings,
      urlAutoCorrect: { ...currentSettings.urlAutoCorrect, ...updates },
    },
  });
}

export function isUrlAutoCorrectEnabled(): boolean {
  return getConfig().settings.urlAutoCorrect.global;
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({
  limit: "1gb",
  verify: (req, _res, buf) => {
    (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
  },
}));
app.use(express.urlencoded({ extended: true, limit: "1gb" }));

function urlCorrectionMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const uac = getConfig().settings.urlAutoCorrect;
  if (!uac.global) { next(); return; }

  const original = req.path;
  let corrected = original;

  corrected = corrected.replace(/\/\/+/g, "/");

  if (/^\/v1\/v1(\/|$)/.test(corrected)) {
    corrected = corrected.replace(/^(\/v1)+/, "/v1");
  }
  if (/^\/api\/v1(\/|$)/.test(corrected)) {
    corrected = corrected.replace(/^\/api\/v1/, "/v1");
  }
  if (/^\/v[2-9]\//.test(corrected)) {
    corrected = corrected.replace(/^\/v\d+\//, "/v1/");
  }

  // /v1beta/v1beta/... → /v1beta/...
  if (/^\/v1beta\/v1beta(\/|$)/.test(corrected)) {
    corrected = corrected.replace(/^(\/v1beta)+/, "/v1beta");
  }
  // /v1/v1beta/... → /v1beta/...
  if (/^\/v1\/v1beta(\/|$)/.test(corrected)) {
    corrected = corrected.replace(/^\/v1\/v1beta/, "/v1beta");
  }

  if (uac.chatCompletions) {
    corrected = corrected.replace(/\/chat\/completion$/, "/chat/completions");
    corrected = corrected.replace(/\/chatcompletions$/, "/chat/completions");
    corrected = corrected.replace(/\/chat_completions$/, "/chat/completions");
    if (/\/v1\/completions$/.test(corrected)) {
      corrected = corrected.replace(/\/v1\/completions$/, "/v1/chat/completions");
    }
    if (/^\/chat\/completions/.test(corrected)) {
      corrected = "/v1" + corrected;
    }
  }

  if (uac.messages) {
    corrected = corrected.replace(/\/message$/, "/messages");
    corrected = corrected.replace(/\/msg$/, "/messages");
    if (/^\/messages$/.test(corrected)) {
      corrected = "/v1" + corrected;
    }
  }

  if (uac.models) {
    corrected = corrected.replace(/\/model$/, "/models");
    if (/^\/models$/.test(corrected)) {
      corrected = "/v1" + corrected;
    }
  }

  if (uac.geminiGenerate) {
    corrected = corrected.replace(/\/generatecontent$/i, "/generateContent");
    // bare /models/:model:generateContent → /v1beta/models/:model:generateContent
    if (/^\/models\/[^/]+:generateContent/.test(corrected)) {
      corrected = "/v1beta" + corrected;
    }
    // /v1/models/:model:generateContent → /v1beta/models/:model:generateContent
    if (/^\/v1\/models\/[^/]+:generateContent/.test(corrected)) {
      corrected = corrected.replace(/^\/v1\//, "/v1beta/");
    }
  }

  if (uac.geminiStream) {
    corrected = corrected.replace(/\/streamgeneratecontent$/i, "/streamGenerateContent");
    // bare /models/:model:streamGenerateContent → /v1beta/models/:model:streamGenerateContent
    if (/^\/models\/[^/]+:streamGenerateContent/.test(corrected)) {
      corrected = "/v1beta" + corrected;
    }
    // /v1/models/:model:streamGenerateContent → /v1beta/models/:model:streamGenerateContent
    if (/^\/v1\/models\/[^/]+:streamGenerateContent/.test(corrected)) {
      corrected = corrected.replace(/^\/v1\//, "/v1beta/");
    }
  }

  corrected = corrected.replace(/\/+$/, "");

  if (corrected !== original) {
    logger.info({ originalPath: original, correctedPath: corrected }, "URL auto-corrected");
    req.url = corrected + (req.url?.includes("?") ? "?" + req.url.split("?")[1] : "");
  }

  next();
}

app.use(urlCorrectionMiddleware);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/api/logs" || req.path === "/api/usage-logs") {
    next();
    return;
  }
  const start = Date.now();
  onFinished(res, () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    pushLog(level, `${req.method} ${req.path} ${status} ${duration}ms`, {
      method: req.method,
      path: req.path,
      status,
      duration,
      ip: req.ip,
      userAgent: req.headers["user-agent"]?.substring(0, 100),
    });
  });
  next();
});

// Management routes
app.use("/api", router);

// Logs API
app.use(logsRouter);
app.use(usageLogsRouter);
app.use(billingRouter);

// OpenAI-compatible endpoints: /v1/models, /v1/chat/completions
app.use("/v1", proxyRouter);

// Gemini native format at /v1beta (MUST be before proxyRouter at /v1beta):
//   GET  /v1beta/models                    — list models (Google format)
//   GET  /v1beta/models/:model             — get single model (Google format)
//   POST /v1beta/models/:model:generateContent / :streamGenerateContent
// Note: /v1beta is the canonical path following Google's official API convention.
app.use("/v1beta", geminiNativeRouter);

// OpenAI-compat fallback at /v1beta (e.g. /v1beta/chat/completions)
app.use("/v1beta", proxyRouter);
app.use(proxyRouter);

// Claude Messages API format: /v1/messages
app.use("/v1", claudeRouter);
app.use("/v1beta", claudeRouter);
app.use(claudeRouter);

// Gemini native format at bare paths (no prefix)
app.use(geminiNativeRouter);

// Image generation: /v1/images/generations
app.use("/v1", imagesRouter);
app.use("/v1beta", imagesRouter);
app.use(imagesRouter);

app.use((req, res) => {
  const path = req.path;
  const method = req.method;
  const validEndpoints = [
    "GET  /v1/models                            (OpenAI format; add anthropic-version header for Anthropic format)",
    "POST /v1/chat/completions",
    "POST /v1/responses",
    "POST /v1/messages",
    "POST /v1/images/generations",
    "GET  /v1beta/models                        (Google Gemini native format)",
    "GET  /v1beta/models/{model}               (Google Gemini native format — single model)",
    "POST /v1beta/chat/completions",
    "POST /v1beta/messages",
    "POST /v1beta/images/generations",
    "POST /v1beta/models/{model}:generateContent",
    "POST /v1beta/models/{model}:streamGenerateContent",
  ];

  const hints: string[] = [];

  if (path === "/" || path === "") {
    hints.push("这是 AI Gateway 的 API 服务器根路径，不提供网页。请使用正确的 API 端点。");
  }
  if (/^\/v1\/v1/.test(path)) {
    hints.push(`路径中有重复的 /v1：${path}。正确路径应去掉多余的 /v1。`);
  }
  if (/^\/api\/v1/.test(path)) {
    hints.push(`路径中有多余的 /api 前缀：${path}。正确路径直接以 /v1 开头（如 /v1/chat/completions）。`);
  }
  if (/\/chat\/completion$/.test(path)) {
    hints.push(`路径拼写错误：completions 少了末尾的 "s"。正确路径：/v1/chat/completions`);
  }
  if (/\/message$/.test(path)) {
    hints.push(`路径拼写错误：messages 少了末尾的 "s"。正确路径：/v1/messages`);
  }
  if (/^\/v1\/completions$/.test(path)) {
    hints.push(`路径缺少 /chat 部分。正确路径：/v1/chat/completions`);
  }
  if (/^\/v2\//.test(path)) {
    hints.push(`本代理仅支持 v1 版本 API。请将路径中的 /v2/ 改为 /v1/。`);
  }
  if (hints.length === 0) {
    hints.push(`路径 ${path} 不存在。请检查 URL 是否正确。`);
  }

  const uacEnabled = getConfig().settings.urlAutoCorrect.global;
  if (uacEnabled) {
    hints.push("注意：请求路径自动纠错已开启但仍无法匹配到有效端点，请检查完整 URL 是否正确。");
  } else {
    hints.push("提示：服务器的请求路径自动纠错功能已关闭。开启后可自动修正常见路径错误。");
  }

  const portalUrl = `${req.protocol}://${req.get("host") || ""}`;
  res.status(404).json({
    error: {
      message: `Not Found: ${method} ${path}`,
      type: "invalid_request_error",
      code: "endpoint_not_found",
      hint: hints.join(" "),
      url_auto_correct: uacEnabled,
      valid_endpoints: validEndpoints,
      docs: portalUrl,
    },
  });
});

app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (
    err instanceof Error &&
    ((err as Error & { status?: number }).status === 413 ||
     (err as Error & { type?: string }).type === "entity.too.large")
  ) {
    res.status(413).json({
      error: {
        message: "请求体过大。请求体大小上限为 1 GB，请减小请求内容后重试。",
        type: "invalid_request_error",
        code: "request_too_large",
      },
    });
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  logger.error({ err, method: req.method, path: req.path }, "Unhandled request error");
  res.status(500).json({
    error: {
      message,
      type: "server_error",
      code: "internal_error",
    },
  });
});

export default app;
