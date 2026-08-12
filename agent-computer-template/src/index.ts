import { ContainerProxy, getSandbox, type Sandbox } from "@cloudflare/sandbox";

export { ContainerProxy, Sandbox } from "@cloudflare/sandbox";

type Env = {
  Sandbox: DurableObjectNamespace<Sandbox>;
  AGENT_DISK: R2Bucket;
  AGENT_TOKEN?: string;
};

type ActionRequest = {
  action?: string;
  characterId?: string;
  path?: string;
  filename?: string;
  mimeType?: string;
  base64?: string;
  content?: string;
  command?: string;
  cwd?: string;
  maxChars?: number;
  timeoutMs?: number;
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function withCors(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) result.set(key, value);
  return result;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: withCors({ "Content-Type": "application/json; charset=utf-8", ...(init.headers ?? {}) }),
  });
}

function fail(error: string, status = 400): Response {
  return json({ ok: false, error }, { status });
}

function isAuthorized(request: Request, env: Env): boolean {
  const expected = env.AGENT_TOKEN?.trim();
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

function cleanCharacterId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
}

async function characterKey(characterId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(characterId));
  return Array.from(new Uint8Array(digest)).slice(0, 18).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function normalizePath(raw: unknown, fallback = "/home/agent"): string {
  let value = typeof raw === "string" ? raw.trim() : "";
  if (!value) value = fallback;
  value = value.replace(/\u0000/g, "");
  if (value === "~") value = "/home/agent";
  if (value.startsWith("~/")) value = `/home/agent/${value.slice(2)}`;
  if (!value.startsWith("/")) value = `/home/agent/${value}`;
  const segments = value.split("/");
  if (segments.some(segment => segment === "..")) throw new Error("路径不能包含 ..");
  const normalized = `/${segments.filter(segment => segment && segment !== ".").join("/")}`;
  if (normalized !== "/home/agent" && !normalized.startsWith("/home/agent/")
    && normalized !== "/workspace" && !normalized.startsWith("/workspace/")) {
    throw new Error("角色电脑只允许访问 /home/agent 和 /workspace。");
  }
  return normalized;
}

function parentDir(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function safeFilename(raw: unknown, fallback: string): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  const base = value.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, "").trim() || fallback;
  return base.slice(0, 160);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function clip(text: string, max = 12_000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[内容过长，已截断]`;
}

function extname(path: string): string {
  const base = path.split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

async function getCharacterComputer(env: Env, characterId: string) {
  const key = await characterKey(characterId);
  const sandbox = getSandbox(env.Sandbox, `character-${key}`, {
    transport: "rpc",
    enableDefaultSession: false,
  });

  await sandbox.exec("mkdir -p /home/agent /workspace", { timeout: 10_000, cwd: "/workspace" });
  try {
    await sandbox.mountBucket("AGENT_DISK", "/home/agent", {
      prefix: `/characters/${key}/`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (!message.includes("already") && !message.includes("mounted") && !message.includes("busy")) throw error;
  }
  await sandbox.exec(
    "mkdir -p /home/agent/Inbox /home/agent/Documents /home/agent/Work /home/agent/Outbox /home/agent/Pictures",
    { timeout: 10_000, cwd: "/workspace" },
  );
  return { sandbox, key };
}

async function actionStatus(sandbox: Sandbox) {
  const result = await sandbox.exec(
    "printf 'OS: '; uname -srm; printf 'Python: '; python3 --version 2>&1; printf 'Node: '; node --version 2>&1; printf 'Home disk: '; df -h /home/agent | tail -n 1",
    { timeout: 15_000, cwd: "/home/agent" },
  );
  return {
    online: result.success,
    summary: clip(result.stdout || result.stderr || "角色电脑已启动。", 4000),
  };
}

async function actionList(sandbox: Sandbox, input: ActionRequest) {
  const path = normalizePath(input.path, "/home/agent");
  const command = `find ${shQuote(path)} -maxdepth 2 -printf '%y\\t%p\\t%s bytes\\n' 2>/dev/null | head -n 200`;
  const result = await sandbox.exec(command, { timeout: 20_000, cwd: "/home/agent" });
  if (!result.success) throw new Error(result.stderr || "读取目录失败");
  return { path, entries: clip(result.stdout, 12_000) };
}

async function actionRead(sandbox: Sandbox, input: ActionRequest) {
  const path = normalizePath(input.path);
  const maxChars = clampNumber(input.maxChars, 500, 12_000, 7000);
  const extension = extname(path);
  let text = "";

  if (extension === ".pdf") {
    const result = await sandbox.exec(`pdftotext -layout ${shQuote(path)} - 2>/dev/null | head -c ${maxChars}`, {
      timeout: 45_000,
      cwd: "/home/agent/Work",
    });
    if (!result.success && !result.stdout) throw new Error(result.stderr || "PDF 读取失败");
    text = result.stdout;
  } else if (extension === ".docx" || extension === ".odt" || extension === ".rtf") {
    const result = await sandbox.exec(`pandoc ${shQuote(path)} -t plain 2>/dev/null | head -c ${maxChars}`, {
      timeout: 45_000,
      cwd: "/home/agent/Work",
    });
    if (!result.success && !result.stdout) throw new Error(result.stderr || "文档读取失败");
    text = result.stdout;
  } else {
    const file = await sandbox.readFile(path, { encoding: "utf-8" });
    text = typeof file.content === "string" ? file.content.slice(0, maxChars) : "";
  }

  return {
    path,
    format: extension || "text",
    content: clip(text || "（文件没有可读取的文本内容）", maxChars),
  };
}

async function actionUpload(sandbox: Sandbox, input: ActionRequest) {
  if (!input.base64 || typeof input.base64 !== "string") throw new Error("缺少上传文件内容 base64");
  if (input.base64.length > 18 * 1024 * 1024) throw new Error("上传内容过大");
  const filename = safeFilename(input.filename, `upload-${Date.now()}.bin`);
  const path = normalizePath(input.path, `/home/agent/Inbox/${filename}`);
  await sandbox.exec(`mkdir -p ${shQuote(parentDir(path))}`, { timeout: 10_000, cwd: "/workspace" });
  await sandbox.writeFile(path, input.base64, { encoding: "base64" });
  return {
    path,
    filename,
    mimeType: input.mimeType || "application/octet-stream",
    message: `附件已保存到 ${path}`,
  };
}

async function actionWrite(sandbox: Sandbox, input: ActionRequest) {
  const path = normalizePath(input.path);
  const content = typeof input.content === "string" ? input.content : "";
  if (content.length > 500_000) throw new Error("单次写入文本过长");
  await sandbox.exec(`mkdir -p ${shQuote(parentDir(path))}`, { timeout: 10_000, cwd: "/workspace" });
  await sandbox.writeFile(path, content);
  return { path, chars: content.length, message: `已写入 ${path}` };
}

async function actionExec(sandbox: Sandbox, input: ActionRequest) {
  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (!command) throw new Error("缺少 command");
  if (command.length > 6000) throw new Error("命令过长");
  const cwd = normalizePath(input.cwd, "/home/agent/Work");
  const timeout = clampNumber(input.timeoutMs, 1000, 60_000, 30_000);
  const result = await sandbox.exec(command, { cwd, timeout });
  return {
    command,
    cwd,
    success: result.success,
    exitCode: result.exitCode,
    stdout: clip(result.stdout || "", 9000),
    stderr: clip(result.stderr || "", 4000),
  };
}

async function actionMakeDocx(sandbox: Sandbox, input: ActionRequest) {
  const filenameBase = safeFilename(input.filename, `document-${Date.now()}.docx`);
  const filename = filenameBase.toLowerCase().endsWith(".docx") ? filenameBase : `${filenameBase}.docx`;
  const content = typeof input.content === "string" ? input.content : "";
  if (!content.trim()) throw new Error("Word 正文不能为空");
  if (content.length > 500_000) throw new Error("Word 正文过长");
  const source = `/workspace/ai-phone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`;
  const output = `/home/agent/Outbox/${filename}`;
  await sandbox.writeFile(source, content);
  const result = await sandbox.exec(`pandoc ${shQuote(source)} -o ${shQuote(output)}`, {
    cwd: "/workspace",
    timeout: 60_000,
  });
  await sandbox.exec(`rm -f ${shQuote(source)}`, { cwd: "/workspace", timeout: 5000 }).catch(() => undefined);
  if (!result.success) throw new Error(result.stderr || "Word 文件制作失败");
  return { path: output, filename, message: `Word 文件已制作：${output}` };
}

async function handleAction(request: Request, env: Env): Promise<Response> {
  let body: ActionRequest;
  try { body = await request.json<ActionRequest>(); }
  catch { return fail("请求体必须是 JSON"); }

  const characterId = cleanCharacterId(body.characterId);
  if (!characterId) return fail("缺少 characterId");
  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!action) return fail("缺少 action");

  try {
    const { sandbox } = await getCharacterComputer(env, characterId);
    let data: unknown;
    switch (action) {
      case "status": data = await actionStatus(sandbox); break;
      case "list": data = await actionList(sandbox, body); break;
      case "read": data = await actionRead(sandbox, body); break;
      case "upload": data = await actionUpload(sandbox, body); break;
      case "write": data = await actionWrite(sandbox, body); break;
      case "exec": data = await actionExec(sandbox, body); break;
      case "make_docx": data = await actionMakeDocx(sandbox, body); break;
      default: return fail(`未知 action：${action}`);
    }
    return json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(message, 500);
  }
}

async function handleFile(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const characterId = cleanCharacterId(url.searchParams.get("characterId"));
  const rawPath = url.searchParams.get("path") || "";
  if (!characterId || !rawPath) return fail("缺少 characterId 或 path");
  try {
    const path = normalizePath(rawPath);
    const { sandbox } = await getCharacterComputer(env, characterId);
    const file = await sandbox.readFile(path, { encoding: "none" });
    const filename = safeFilename(path, "file.bin");
    return new Response(file.content, {
      status: 200,
      headers: withCors({
        "Content-Type": file.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
      }),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 404);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: withCors() });
    if (!env.AGENT_TOKEN?.trim()) return fail("Worker 尚未配置 AGENT_TOKEN secret", 503);
    if (!isAuthorized(request, env)) return fail("Unauthorized", 401);

    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "ai-phone-agent-computer", version: "0.1.0" });
    }
    if (url.pathname === "/v1/action" && request.method === "POST") return handleAction(request, env);
    if (url.pathname === "/v1/file" && request.method === "GET") return handleFile(request, env);
    return fail("Not found", 404);
  },
};
