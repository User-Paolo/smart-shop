#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    import numpy as np
    import pandas as pd
    import pymysql
    from sklearn.linear_model import LinearRegression
    from sklearn.metrics import mean_absolute_error
    MISSING_PACKAGE = None
except ImportError as exc:
    MISSING_PACKAGE = exc.name

HISTORY_DAYS = 90
HORIZON_DAYS = 7
HOLDOUT_DAYS = 14
BASELINE_DAYS = 28
MIN_SALES_DAYS = 10
MODEL_NAME = "LinearRegression+DoW"
BASELINE_NAME = "MovingAverage28"

log = logging.getLogger("forecast")


class StatusReporter:
    def __init__(self, path: str | None) -> None:
        self.path = Path(path) if path else None
        self.started_at = now_local().isoformat(timespec="seconds")

    def write(self, state: str, message: str, **extra) -> None:
        if not self.path:
            return
        payload = {"state": state, "message": message, "started_at": self.started_at, **extra}
        if state in ("done", "failed"):
            payload["finished_at"] = now_local().isoformat(timespec="seconds")
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        tmp.replace(self.path)  # atomic, so PHP never reads half a file


def now_local() -> datetime:
    return datetime.now(ZoneInfo(os.getenv("APP_TIMEZONE", "Europe/Athens"))).replace(microsecond=0)


def connect(now: datetime):
    conn = pymysql.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "3306")),
        database=os.getenv("DB_NAME", "smart_shop"),
        user=os.getenv("DB_USER", "shop_app"),
        password=os.getenv("DB_PASSWORD", "shop_pass"),
        charset="utf8mb4",
        autocommit=False,
    )
    offset = now.strftime("%z")
    with conn.cursor() as cur:
        cur.execute("SET time_zone = %s", (f"{offset[:3]}:{offset[3:]}",))
    return conn


def extract_sales(conn, today: date):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT oi.product_id, DATE(o.created_at) AS day, SUM(oi.quantity) AS units
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.status <> 'cancelled' AND o.created_at >= %s AND o.created_at < %s
            GROUP BY oi.product_id, DATE(o.created_at)
            """,
            (today - timedelta(days=HISTORY_DAYS), today),
        )
        sales = pd.DataFrame(cur.fetchall(), columns=["product_id", "day", "units"])
        cur.execute("SELECT id, name FROM products WHERE is_active = 1")
        products = pd.DataFrame(cur.fetchall(), columns=["product_id", "name"])
    if not sales.empty:
        sales["day"] = pd.to_datetime(sales["day"])
        sales["units"] = sales["units"].astype(float)
    return sales, products


def load_forecasts(conn, rows: list[tuple], today: date) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM inventory_forecasts WHERE forecast_date >= %s", (today,))
        cur.executemany(
            """
            INSERT INTO inventory_forecasts (product_id, forecast_date, predicted_quantity, model_name, generated_at)
            VALUES (%s, %s, %s, %s, %s)
            """,
            rows,
        )
    conn.commit()


# Columns: day number for the trend, then one flag per weekday (Sunday is the baseline)
def build_features(days, origin):
    t = (days - origin).days.to_numpy(dtype=float).reshape(-1, 1)
    dow = np.zeros((len(days), 6))
    for i, weekday in enumerate(days.weekday):
        if weekday < 6:
            dow[i, weekday] = 1.0
    return np.hstack([t, dow])


@dataclass
class ProductForecast:
    product_id: int
    name: str
    predictions: list[float]
    model: str
    mae: float | None = None
    baseline_mae: float | None = None

    @property
    def skill(self) -> float | None:
        if self.mae is None or not self.baseline_mae:
            return None
        return round(1 - self.mae / self.baseline_mae, 3)


def forecast_product(pid: int, name: str, series, future) -> ProductForecast:
    y = series.to_numpy()
    if int((series > 0).sum()) < MIN_SALES_DAYS:
        average = round(float(series.tail(BASELINE_DAYS).mean()), 2)
        return ProductForecast(pid, name, [average] * len(future), BASELINE_NAME)

    origin = series.index[0]
    X = build_features(series.index, origin)
    model = LinearRegression().fit(X[:-HOLDOUT_DAYS], y[:-HOLDOUT_DAYS])
    holdout = y[-HOLDOUT_DAYS:]
    mae = float(mean_absolute_error(holdout, np.clip(model.predict(X[-HOLDOUT_DAYS:]), 0, None)))
    baseline = y[-HOLDOUT_DAYS - BASELINE_DAYS:-HOLDOUT_DAYS].mean()
    baseline_mae = float(mean_absolute_error(holdout, np.full(HOLDOUT_DAYS, baseline)))

    # Keep the regression only if it beat the simple average on the hold out days
    if mae < baseline_mae:
        model.fit(X, y)
        preds = np.clip(model.predict(build_features(future, origin)), 0, None)
        return ProductForecast(pid, name, [round(float(p), 2) for p in preds], MODEL_NAME, round(mae, 3), round(baseline_mae, 3))
    average = round(float(y[-BASELINE_DAYS:].mean()), 2)
    return ProductForecast(pid, name, [average] * len(future), BASELINE_NAME, round(mae, 3), round(baseline_mae, 3))


def run(dry_run: bool, status: StatusReporter) -> int:
    if MISSING_PACKAGE:
        message = f"Missing package: {MISSING_PACKAGE}. Run pip install -r analytics/requirements.txt"
        log.error(message)
        status.write("failed", message)
        return 1

    now = now_local()
    today = now.date()
    status.write("running", "Extracting sales history...")
    conn = None
    try:
        conn = connect(now)
        sales, products = extract_sales(conn, today)
        history = pd.date_range(today - timedelta(days=HISTORY_DAYS), today - timedelta(days=1), freq="D")
        future = pd.date_range(today, periods=HORIZON_DAYS, freq="D")
        matrix = (
            sales.pivot_table(index="day", columns="product_id", values="units", aggfunc="sum")
            if not sales.empty else pd.DataFrame(index=history)
        ).reindex(history, fill_value=0).fillna(0)

        status.write("running", f"Fitting models for {len(products)} products...")
        results = [
            forecast_product(int(p.product_id), p.name,
                             matrix[p.product_id] if p.product_id in matrix.columns else pd.Series(0.0, index=history),
                             future)
            for p in products.itertuples(index=False)
        ]
        for r in results:
            log.info("%-28s %-22s 7 day demand %6.1f  skill %s", r.name[:28], r.model, sum(r.predictions), r.skill)

        scored = [r for r in results if r.mae is not None]
        mae = round(sum(r.mae for r in scored) / len(scored), 3) if scored else None
        base = round(sum(r.baseline_mae for r in scored) / len(scored), 3) if scored else None
        best = round(sum(min(r.mae, r.baseline_mae) for r in scored) / len(scored), 3) if scored else None
        log.info("Hold out MAE: regression %s, baseline %s, chosen per product %s units/day", mae, base, best)

        generated_at = now.replace(tzinfo=None)
        rows = [(r.product_id, d.date(), q, r.model, generated_at) for r in results for d, q in zip(future, r.predictions)]
        if not dry_run:
            load_forecasts(conn, rows, today)
        log.info("%s %d forecast rows.", "Dry run, not writing" if dry_run else "Wrote", len(rows))

        status.write(
            "done", f"Forecast complete for {len(results)} products.",
            products=len(results), rows_written=0 if dry_run else len(rows),
            mean_holdout_mae=best, mean_baseline_mae=base,
            skill_vs_baseline=round(1 - best / base, 3) if base else None,
            generated_at=generated_at.isoformat(sep=" "),
        )
        return 0
    except Exception as exc:
        if conn:
            conn.rollback()
        log.exception("Forecast run failed")
        status.write("failed", f"{type(exc).__name__}: {exc}")
        return 1
    finally:
        if conn:
            conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="7 day inventory demand forecaster")
    parser.add_argument("--status-file", help="JSON file the PHP API reads for progress")
    parser.add_argument("--dry-run", action="store_true", help="compute forecasts without writing them")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", stream=sys.stdout)
    return run(args.dry_run, StatusReporter(args.status_file))


if __name__ == "__main__":
    sys.exit(main())
