from datetime import date, timedelta

import numpy as np
import pandas as pd

from forecast import BASELINE_NAME, HORIZON_DAYS, MODEL_NAME, build_features, forecast_product

START = date(2026, 1, 5)


def days(n):
    return pd.date_range(START, periods=n, freq="D")


def future(n_history):
    return pd.date_range(START + timedelta(days=n_history), periods=HORIZON_DAYS, freq="D")


def test_features_are_trend_plus_six_weekday_flags():
    X = build_features(days(14), pd.Timestamp(START))
    assert X.shape == (14, 7)
    assert list(X[:, 0]) == list(range(14))
    assert X[6, 1:].sum() == 0  # Sunday is the baseline day


def test_trend_and_weekends_are_learned():
    idx = days(90)
    y = 2 + 0.05 * np.arange(90) + np.where(idx.weekday >= 5, 3, 0)
    result = forecast_product(1, "trend", pd.Series(y, index=idx), future(90))
    assert result.model == MODEL_NAME
    assert result.skill > 0.5
    expected = 2 + 0.05 * np.arange(90, 97) + np.where(future(90).weekday >= 5, 3, 0)
    assert np.allclose(result.predictions, expected, atol=0.05)


def test_regression_that_loses_on_the_hold_out_is_replaced_by_the_average():
    t = np.arange(90, dtype=float)
    y = 0.1 * t
    y[76:] = y[48:76].mean()
    result = forecast_product(2, "trend stops", pd.Series(y, index=days(90)), future(90))
    assert result.mae > result.baseline_mae
    assert result.model == BASELINE_NAME
    assert len(set(result.predictions)) == 1

def test_rarely_sold_products_use_the_average():
    y = np.zeros(90)
    y[[10, 40, 80]] = 2
    result = forecast_product(3, "rare", pd.Series(y, index=days(90)), future(90))
    assert result.model == BASELINE_NAME
    assert result.mae is None


def test_predictions_are_never_negative():
    y = np.maximum(0, 20 - 0.3 * np.arange(90))
    result = forecast_product(4, "falling", pd.Series(y, index=days(90)), future(90))
    assert min(result.predictions) >= 0
