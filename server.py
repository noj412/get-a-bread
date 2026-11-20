"""Local job workbench. Python standard library only."""
import argparse
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent


def stamp():
    return datetime.now(timezone.utc).isoformat()


def canonical(raw):
    url = urlsplit(raw)
    if url.scheme not in ("http", "https") or not url.hostname:
        raise ValueError("岗位须提供 http/https 原始链接")
    return urlunsplit((url.scheme, url.netloc.lower(), url.path, "", ""))


def connect():
    db = sqlite3.connect(DB)
    db.execute("CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, body TEXT, PRIMARY KEY(kind,id))")
    return db


def upsert(db, kind, key, value):
    db.execute("INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
               (kind, key, json.dumps(value, ensure_ascii=False)))


def get_record(db, kind, key):
    row = db.execute("SELECT body FROM records WHERE kind=? AND id=?", (kind, key)).fetchone()
    return json.loads(row[0]) if row else None


def import_batch(payload):
    run = payload.get("run")
    jobs = payload.get("jobs")
    if not isinstance(run, dict) or not isinstance(jobs, list):
        raise ValueError("需要 run 对象和 jobs 数组")
    if not all(isinstance(run.get(key), str) and run[key].strip() for key in ("id", "source", "keyword", "city", "state")):
        raise ValueError("run 缺少 id/source/keyword/city/state")
    if run["state"] not in ("已完成", "部分完成", "登录阻塞", "验证阻塞", "连接失败"):
        raise ValueError("run.state 不受支持")
    prepared = []
    for job in jobs:
        if not isinstance(job, dict) or not all(isinstance(job.get(k), str) and job[k].strip() for k in ("company", "title", "url", "jd")):
            raise ValueError("每条岗位需要 company/title/url/jd")
        url = canonical(job["url"])
        key = hashlib.sha256(url.encode()).hexdigest()[:24]
        prepared.append((key, {**job, "url": url}))
    now = stamp()
    inserted = updated = 0
    with connect() as db:
        # Acquire the write lock before reading so concurrent imports preserve decisions.
        db.execute("BEGIN IMMEDIATE")
        for key, job in prepared:
            old = get_record(db, "jobs", key) or {}
            old_hash = old.get("jdHash")
            jd_hash = hashlib.sha256(job["jd"].encode()).hexdigest()
            hits = list(dict.fromkeys(old.get("runIds", []) + [run["id"]]))
            result = {**old, **job, "id": key, "runIds": hits,
                      "firstSeen": old.get("firstSeen", now), "updatedAt": now,
                      "status": old.get("status", "待评估"),
                      "appliedAt": old.get("appliedAt"),
                      "history": old.get("history", []),
                      "reason": old.get("reason", ""), "jdHash": jd_hash}
            if old_hash and old_hash != jd_hash:
                result["review"] = None
                result["reviewState"] = "JD已变化，待重新评估"
            upsert(db, "jobs", key, result)
            inserted += not bool(old)
            updated += bool(old)
        upsert(db, "runs", run["id"], {**run, "recordedAt": now, "readCount": len(jobs)})
    return {"inserted": inserted, "updated": updated, "readCount": len(jobs), "runId": run["id"]}


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/api/state":
            state = {key: [] for key in ("jobs", "runs", "evidence", "plans")}
            with connect() as db:
                for kind, body in db.execute("SELECT kind,body FROM records"):
                    state[kind].append(json.loads(body))
            return self.reply(200, state)
        files = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
                 "/style.css": ("style.css", "text/css"), "/example.json": ("example.json", "application/json")}
        if self.path not in files:
            return self.reply(404, {"error": "不存在的入口"})
        name, mime = files[self.path]
        raw = (ROOT / name).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime + "; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        # Same-origin browser writes only. CLI collectors may omit Origin.
        if self.headers.get("Origin") not in (None, f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}"):
            return self.reply(403, {"error": "来源不匹配"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 5_000_000:
                raise ValueError("请求内容须为1字节至5MB")
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError("请求须为 JSON 对象")
            if self.path == "/api/import":
                return self.reply(200, import_batch(payload))
            if self.path == "/api/decision":
                status = payload["status"]
                if status not in ("待评估", "待跟进", "已沟通", "已投递", "不匹配", "跳过"):
                    raise ValueError("状态无效")
                with connect() as db:
                    db.execute("BEGIN IMMEDIATE")
                    job = get_record(db, "jobs", payload["id"])
                    if not job:
                        raise ValueError("岗位不存在")
                    history = job.get("history", [])
                    history.append({"at": stamp(), "from": job["status"], "to": status, "reason": payload.get("reason", "")})
                    job.update(status=status, reason=payload.get("reason", ""), history=history, updatedAt=stamp())
                    if status == "已投递" and not job.get("appliedAt"):
                        job["appliedAt"] = stamp()
                    upsert(db, "jobs", job["id"], job)
                return self.reply(200, {"saved": True})
            if self.path == "/api/material":
                kind = payload["kind"]
                item = payload["item"]
                if kind not in ("plans", "evidence") or not isinstance(item, dict) or not item.get("id"):
                    raise ValueError("需要 plans/evidence 和带 id 的 item")
                with connect() as db:
                    upsert(db, kind, item["id"], item)
                return self.reply(200, {"saved": True})
            return self.reply(404, {"error": "不存在的入口"})
        except (ValueError, KeyError, TypeError) as error:
            return self.reply(400, {"error": str(error)})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8876)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    args = parser.parse_args()
    args.data_dir.mkdir(parents=True, exist_ok=True)
    DB = args.data_dir / "workbench.sqlite3"
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        print(f"搜岗助手 http://127.0.0.1:{args.port}", flush=True)
        server.serve_forever()
