"use client";

import { FormEvent, useState } from "react";

type Brief = {
  projectName: string;
  features: string[];
  timeline: string;
};

export default function Home() {
  const [idea, setIdea] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBrief(null);
    setLoading(true);
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea: idea.trim() }),
      });
      const data = (await res.json()) as Brief & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "요청에 실패했습니다.");
        return;
      }
      if (
        !data.projectName ||
        !Array.isArray(data.features) ||
        !data.timeline
      ) {
        setError("응답 형식이 올바르지 않습니다.");
        return;
      }
      setBrief({
        projectName: data.projectName,
        features: data.features,
        timeline: data.timeline,
      });
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full flex flex-col bg-gradient-to-b from-zinc-100 to-zinc-200 text-zinc-900 dark:from-zinc-950 dark:to-zinc-900 dark:text-zinc-100">
      <header className="border-b border-zinc-200/80 bg-white/70 px-6 py-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/70">
        <h1 className="text-lg font-semibold tracking-tight">
          아이디어 → 기획서
        </h1>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          한 줄 아이디어를 넣으면 Claude가 프로젝트명·주요 기능 5가지·예상 일정을
          한국어로 정리합니다.
        </p>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label htmlFor="idea" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            프로젝트 아이디어 (한 줄)
          </label>
          <textarea
            id="idea"
            name="idea"
            rows={3}
            value={idea}
            onChange={(ev) => setIdea(ev.target.value)}
            placeholder="예: 직장인 점심 메뉴를 팀원과 투표로 정하는 모바일 앱"
            className="w-full resize-y rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base shadow-sm outline-none ring-zinc-400/30 placeholder:text-zinc-400 focus:border-violet-500 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-violet-400"
            disabled={loading}
            maxLength={2000}
          />
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-zinc-500">{idea.length} / 2000</span>
            <button
              type="submit"
              disabled={loading || !idea.trim()}
              className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400"
            >
              {loading ? "생성 중…" : "기획서 만들기"}
            </button>
          </div>
        </form>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          >
            {error}
          </div>
        )}

        {brief && (
          <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
              프로젝트명
            </h2>
            <p className="mt-1 text-xl font-semibold">{brief.projectName}</p>

            <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
              주요 기능 (5)
            </h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-zinc-700 dark:text-zinc-300">
              {brief.features.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ol>

            <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
              예상 일정
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
              {brief.timeline}
            </p>
          </article>
        )}
      </main>
    </div>
  );
}
