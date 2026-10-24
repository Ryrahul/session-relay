import { useEffect, useState } from "react";
import type { Stats as StatsData } from "@session-relay/shared";
import { api } from "../api";
import { shortRepo, TOOL_NAMES } from "../format";
import { Avatar } from "../ui";

const PERIODS = [7, 30, 90];

const dayLabel = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

/** One column per day: shares. Hover or focus a day for shares and pickups. */
function DayChart({ days }: { days: StatsData["by_day"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.shares));
  const step = max <= 4 ? 1 : Math.ceil(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const h = 160;
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));
  const active = hover === null ? null : days[hover]!;
  return (
    <figure className="day-chart">
      <figcaption className="sr-only">Sessions shared per day</figcaption>
      <div className="day-chart-plot" style={{ height: h }} onMouseLeave={() => setHover(null)}>
        <div className="day-chart-grid" aria-hidden="true">
          {ticks.map((t) => (
            <div key={t} className="gridline" style={{ bottom: `${(t / top) * 100}%` }}>
              <span>{t}</span>
            </div>
          ))}
        </div>
        <div className="day-chart-bars">
          {days.map((d, i) => (
            <button
              key={d.day}
              type="button"
              className={`day ${hover === i ? "on" : ""}`}
              aria-label={`${dayLabel(d.day)}: ${d.shares} shared, ${d.pickups} picked up`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <span className="bar" style={{ height: `${(d.shares / top) * 100}%` }} />
            </button>
          ))}
        </div>
        {active && hover !== null && (
          <div className="chart-tip" style={{ left: `${((hover + 0.5) / days.length) * 100}%` }} role="status">
            <strong>{dayLabel(active.day)}</strong>
            <span>{active.shares} shared</span>
            <span>{active.pickups} picked up</span>
          </div>
        )}
      </div>
      <div className="day-chart-axis" aria-hidden="true">
        {days.map((d, i) =>
          i % labelEvery === 0 && i < days.length - labelEvery / 2 ? (
            <span key={d.day} style={{ left: `${((i + 0.5) / days.length) * 100}%` }}>
              {dayLabel(d.day)}
            </span>
          ) : null,
        )}
        <span style={{ left: "100%" }}>{dayLabel(days[days.length - 1]!.day)}</span>
      </div>
    </figure>
  );
}

/** Horizontal bars for a ranked list, value at the tip. */
function BarList({ rows }: { rows: { label: string; value: number; title?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="bar-list">
      {rows.map((r) => (
        <li key={r.label} title={r.title ?? r.label}>
          <span className="bar-label">{r.label}</span>
          <span className="bar-track">
            <span className="bar-area">
              <span className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            <span className="bar-value">{r.value}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Stats() {
  const [days, setDays] = useState(30);
  const [st, setSt] = useState<StatsData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setSt(null);
    api.stats(days).then(setSt, (e) => setError(e.message));
  }, [days]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Stats</h1>
          <p className="muted">How your team hands work off.</p>
        </div>
      </header>
      <div className="chips" role="group" aria-label="Period">
        {PERIODS.map((d) => (
          <button key={d} type="button" className={`chip ${days === d ? "on" : ""}`} aria-pressed={days === d} onClick={() => setDays(d)}>
            Last {d} days
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {!st && !error && <div className="skeleton-list" aria-busy="true" />}
      {st && (
        <>
          <div className="tiles">
            {(
              [
                ["shares", "shared"],
                ["pickups", "picked up"],
                ["continued", "continued"],
                ["comments", "comments"],
                ["active_people", "active people"],
              ] as const
            ).map(([k, label]) => (
              <div className="tile" key={k}>
                <span className="tile-value">{st.totals[k]}</span>
                <span className="tile-label">{label}</span>
              </div>
            ))}
          </div>

          <section className="card">
            <h2>Shared per day</h2>
            <DayChart days={st.by_day} />
            <details className="table-view">
              <summary>Show as table</summary>
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Shared</th>
                    <th>Picked up</th>
                  </tr>
                </thead>
                <tbody>
                  {st.by_day.map((d) => (
                    <tr key={d.day}>
                      <td>{dayLabel(d.day)}</td>
                      <td>{d.shares}</td>
                      <td>{d.pickups}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>

          <section className="card">
            <h2>People</h2>
            <table className="people-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Shared</th>
                  <th>Picked up</th>
                  <th>Comments</th>
                </tr>
              </thead>
              <tbody>
                {st.by_person.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="who">
                        <Avatar name={p.name} size={22} /> {p.name}
                      </span>
                    </td>
                    <td>{p.shares}</td>
                    <td>{p.pickups}</td>
                    <td>{p.comments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="stats-split">
            <section className="card">
              <h2>By agent</h2>
              {st.by_tool.length ? <BarList rows={st.by_tool.map((t) => ({ label: TOOL_NAMES[t.tool] ?? t.tool, value: t.shares }))} /> : <p className="muted small">No shares yet.</p>}
            </section>
            <section className="card">
              <h2>By repository</h2>
              {st.by_repo.length ? (
                <BarList rows={st.by_repo.map((r) => ({ label: shortRepo(r.repo), value: r.shares, title: r.repo }))} />
              ) : (
                <p className="muted small">No shares yet.</p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
