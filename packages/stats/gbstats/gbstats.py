from dataclasses import asdict
import re
from typing import Any, Dict, Hashable, List, Optional, Set, Tuple, Union

import pandas as pd

from gbstats.bayesian.tests import (
    BayesianTestResult,
    EffectBayesianABTest,
    EffectBayesianConfig,
    GaussianPrior,
    BanditConfig,
    Bandits,
    BanditsRatio,
    BanditsCuped,
)
from gbstats.frequentist.tests import (
    FrequentistConfig,
    FrequentistTestResult,
    SequentialConfig,
    SequentialTwoSidedTTest,
    TwoSidedTTest,
)
from gbstats.models.results import (
    BaselineResponse,
    BayesianVariationResponse,
    DimensionResponse,
    ExperimentMetricAnalysis,
    ExperimentMetricAnalysisResult,
    FrequentistVariationResponse,
    MetricStats,
    MultipleExperimentMetricAnalysis,
    BanditResult,
    SingleVariationResult,
)
from gbstats.models.settings import (
    AnalysisSettingsForStatsEngine,
    BanditSettingsForStatsEngine,
    DataForStatsEngine,
    ExperimentDataForStatsEngine,
    ExperimentMetricQueryResponseRows,
    MetricSettingsForStatsEngine,
    MetricType,
    QueryResultsForStatsEngine,
    VarIdMap,
)
from gbstats.models.statistics import (
    ProportionStatistic,
    QuantileStatistic,
    QuantileClusteredStatistic,
    RatioStatistic,
    RegressionAdjustedStatistic,
    SampleMeanStatistic,
    TestStatistic,
    BanditStatistic,
)
from gbstats.utils import check_srm


SUM_COLS = [
    "users",
    "count",
    "main_sum",
    "main_sum_squares",
    "denominator_sum",
    "denominator_sum_squares",
    "main_denominator_sum_product",
    "covariate_sum",
    "covariate_sum_squares",
    "main_covariate_sum_product",
]

ROW_COLS = SUM_COLS + [
    "quantile_n",
    "quantile_nstar",
    "quantile",
    "quantile_lower",
    "quantile_upper",
]


# Looks for any variation ids that are not in the provided map
def detect_unknown_variations(
    rows, var_ids: Set[str], ignore_ids: Set[str] = {"__multiple__"}
) -> Set[str]:
    unknown_var_ids = []
    for row in rows.itertuples(index=False):
        id = str(row.variation)
        if id not in ignore_ids and id not in var_ids:
            unknown_var_ids.append(id)
    return set(unknown_var_ids)


def diff_for_daily_time_series(df: pd.DataFrame) -> pd.DataFrame:
    dfc = df.copy()
    diff_cols = [
        x
        for x in [
            "main_sum",
            "main_sum_squares",
            "denominator_sum",
            "denominator_sum_squares",
            "main_denominator_sum_product",
            "main_covariate_sum_product",
        ]
        if x in dfc.columns
    ]
    dfc.sort_values("dimension", inplace=True)
    dfc[diff_cols] = dfc.groupby(["variation"])[diff_cols].diff().fillna(dfc[diff_cols])
    return dfc


# Transform raw SQL result for metrics into a dataframe of dimensions
def get_metric_df(
    rows: pd.DataFrame, var_id_map: VarIdMap, var_names: List[str], bandit: bool = False
):
    dfc = rows.copy()
    dimensions = {}  # dict of dimensions for fixed_weight, dict of periods for bandits
    # Each row in the raw SQL result is a dimension/variation combo
    # We want to end up with one row per dimension
    for row in dfc.itertuples(index=False):
        if bandit:
            dim = row.bandit_period
        else:
            dim = row.dimension
        # If this is the first time we're seeing this dimension, create an empty dict
        if dim not in dimensions:
            # Overall columns
            if bandit:
                dimensions[dim] = {
                    "bandit_period": dim,
                    "variations": len(var_names),
                    "total_users": 0,
                }
            else:
                dimensions[dim] = {
                    "dimension": dim,
                    "variations": len(var_names),
                    "total_users": 0,
                }
            # Add columns for each variation (including baseline)
            for key in var_id_map:
                i = var_id_map[key]
                prefix = f"v{i}" if i > 0 else "baseline"
                dimensions[dim][f"{prefix}_id"] = key
                dimensions[dim][f"{prefix}_name"] = var_names[i]
                for col in ROW_COLS:
                    dimensions[dim][f"{prefix}_{col}"] = 0

        # Add this SQL result row into the dimension dict if we recognize the variation
        key = str(row.variation)
        if key in var_id_map:
            i = var_id_map[key]
            dimensions[dim]["total_users"] += row.users
            prefix = f"v{i}" if i > 0 else "baseline"
            for col in ROW_COLS:
                dimensions[dim][f"{prefix}_{col}"] = getattr(row, col, 0)
            # Special handling for count, if missing returns a method, so override with user value
            if callable(getattr(row, "count")):
                dimensions[dim][f"{prefix}_count"] = getattr(row, "users", 0)

    return pd.DataFrame(dimensions.values())


# Limit to the top X dimensions with the most users
# Merge the rest into an "(other)" dimension
def reduce_dimensionality(
    df: pd.DataFrame, max: int = 20, keep_other: bool = True
) -> pd.DataFrame:
    num_variations = df.at[0, "variations"]

    rows = df.to_dict("records")
    rows.sort(key=lambda i: i["total_users"], reverse=True)

    newrows = []

    for i, row in enumerate(rows):
        # For the first few dimensions, keep them as-is
        if i < max:
            newrows.append(row)
        # For the rest, merge them into the last dimension
        elif keep_other:
            current = newrows[max - 1]
            current["dimension"] = "(other)"
            current["total_users"] += row["total_users"]
            for v in range(num_variations):
                prefix = f"v{v}" if v > 0 else "baseline"
                for col in SUM_COLS:
                    current[f"{prefix}_{col}"] += row[f"{prefix}_{col}"]

    return pd.DataFrame(newrows)


def get_configured_test(
    row: pd.Series,
    test_index: int,
    analysis: AnalysisSettingsForStatsEngine,
    metric: MetricSettingsForStatsEngine,
) -> Union[EffectBayesianABTest, SequentialTwoSidedTTest, TwoSidedTTest]:

    stat_a = variation_statistic_from_metric_row(row, "baseline", metric)
    stat_b = variation_statistic_from_metric_row(row, f"v{test_index}", metric)

    base_config = {
        "traffic_proportion_b": analysis.weights[test_index],
        "phase_length_days": analysis.phase_length_days,
        "difference_type": analysis.difference_type,
    }

    if analysis.stats_engine == "frequentist":
        if analysis.sequential_testing_enabled:
            return SequentialTwoSidedTTest(
                stat_a,
                stat_b,
                SequentialConfig(
                    **base_config,
                    alpha=analysis.alpha,
                    sequential_tuning_parameter=analysis.sequential_tuning_parameter,
                ),
            )
        else:
            return TwoSidedTTest(
                stat_a,
                stat_b,
                FrequentistConfig(
                    **base_config,
                    alpha=analysis.alpha,
                ),
            )
    else:
        assert type(stat_a) is type(stat_b), "stat_a and stat_b must be of same type."
        prior = GaussianPrior(
            mean=metric.prior_mean,
            variance=pow(metric.prior_stddev, 2),
            proper=metric.prior_proper,
        )
        return EffectBayesianABTest(
            stat_a,
            stat_b,
            EffectBayesianConfig(
                **base_config,
                inverse=metric.inverse,
                prior_effect=prior,
                prior_type="relative",
            ),
        )


# Run A/B test analysis for each variation and dimension
def analyze_metric_df(
    df: pd.DataFrame,
    metric: MetricSettingsForStatsEngine,
    analysis: AnalysisSettingsForStatsEngine,
) -> pd.DataFrame:
    num_variations = df.at[0, "variations"]

    # Add new columns to the dataframe with placeholder values
    df["srm_p"] = 0
    df["engine"] = analysis.stats_engine
    df["baseline_cr"] = 0
    df["baseline_mean"] = None
    df["baseline_stddev"] = None

    def dummy_df(i):
        return pd.DataFrame(
            {
                f"v{i}_cr": [i],
                f"v{i}_mean": [None],
                f"v{i}_stddev": [None],
                f"v{i}_expected": [i],
                f"v{i}_p_value": [None],
                f"v{i}_risk": [None],
                f"v{i}_prob_beat_baseline": [None],
                f"v{i}_uplift": [None],
                f"v{i}_error_message": [None],
            }
        )

    for i in range(1, num_variations):
        df = pd.concat([df, dummy_df(i)], axis=1)

    def analyze_row(s: pd.Series) -> pd.Series:
        s = s.copy()

        # Loop through each non-baseline variation and run an analysis
        for i in range(1, num_variations):

            # Run analysis of baseline vs variation
            test = get_configured_test(
                row=s, test_index=i, analysis=analysis, metric=metric
            )
            res = test.compute_result()
            s["baseline_cr"] = test.stat_a.unadjusted_mean
            s["baseline_mean"] = test.stat_a.unadjusted_mean
            s["baseline_stddev"] = test.stat_a.stddev

            s[f"v{i}_cr"] = test.stat_b.unadjusted_mean
            s[f"v{i}_mean"] = test.stat_b.unadjusted_mean
            s[f"v{i}_stddev"] = test.stat_b.stddev

            # Unpack result in Pandas row
            if isinstance(res, BayesianTestResult):
                s.at[f"v{i}_risk"] = res.risk
                s[f"v{i}_risk_type"] = res.risk_type
                s[f"v{i}_prob_beat_baseline"] = res.chance_to_win
            elif isinstance(res, FrequentistTestResult):
                s[f"v{i}_p_value"] = res.p_value
            if test.stat_a.unadjusted_mean <= 0:
                # negative or missing control mean
                s[f"v{i}_expected"] = 0
            elif res.expected == 0:
                # if result is not valid, try to return at least the diff
                s[f"v{i}_expected"] = (
                    test.stat_b.mean - test.stat_a.mean
                ) / test.stat_a.unadjusted_mean
            else:
                # return adjusted/prior-affected guess of expectation
                s[f"v{i}_expected"] = res.expected
            s.at[f"v{i}_ci"] = res.ci
            s.at[f"v{i}_uplift"] = asdict(res.uplift)
            s[f"v{i}_error_message"] = res.error_message

        # replace count with quantile_n for quantile metrics
        if metric.statistic_type in ["quantile_event", "quantile_unit"]:
            for i in range(num_variations):
                prefix = f"v{i}" if i > 0 else "baseline"
                s[f"{prefix}_count"] = s[f"{prefix}_quantile_n"]

        s["srm_p"] = check_srm(
            [s["baseline_users"]]
            + [s[f"v{i}_users"] for i in range(1, num_variations)],
            analysis.weights,
        )
        return s

    return df.apply(analyze_row, axis=1)


# Convert final experiment results to a structure that can be easily
# serialized and used to display results in the GrowthBook front-end
def format_results(
    df: pd.DataFrame, baseline_index: int = 0
) -> List[DimensionResponse]:
    num_variations = df.at[0, "variations"]
    results: List[DimensionResponse] = []
    rows = df.to_dict("records")
    for row in rows:
        dim = DimensionResponse(
            dimension=row["dimension"], srm=row["srm_p"], variations=[]
        )
        baseline_data = format_variation_result(row, 0)
        variation_data = [
            format_variation_result(row, v) for v in range(1, num_variations)
        ]
        variation_data.insert(baseline_index, baseline_data)
        dim.variations = variation_data
        results.append(dim)
    return results


def format_variation_result(
    row: Dict[Hashable, Any], v: int
) -> Union[BaselineResponse, BayesianVariationResponse, FrequentistVariationResponse]:
    prefix = f"v{v}" if v > 0 else "baseline"

    # if quantile_n
    stats = MetricStats(
        users=row[f"{prefix}_users"],
        count=row[f"{prefix}_count"],
        stddev=row[f"{prefix}_stddev"],
        mean=row[f"{prefix}_mean"],
    )
    metricResult = {
        "cr": row[f"{prefix}_cr"],
        "value": row[f"{prefix}_main_sum"],
        "users": row[f"{prefix}_users"],
        "denominator": row[f"{prefix}_denominator_sum"],
        "stats": stats,
    }
    if v == 0:
        # baseline variation
        return BaselineResponse(**metricResult)
    else:
        # non-baseline variation
        frequentist = row[f"{prefix}_p_value"] is not None
        testResult = {
            "expected": row[f"{prefix}_expected"],
            "uplift": row[f"{prefix}_uplift"],
            "ci": row[f"{prefix}_ci"],
            "errorMessage": row[f"{prefix}_error_message"],
        }
        if frequentist:
            return FrequentistVariationResponse(
                **metricResult,
                **testResult,
                pValue=row[f"{prefix}_p_value"],
            )
        else:
            return BayesianVariationResponse(
                **metricResult,
                **testResult,
                chanceToWin=row[f"{prefix}_prob_beat_baseline"],
                risk=row[f"{prefix}_risk"],
                riskType=row[f"{prefix}_risk_type"],
            )


def variation_statistic_from_metric_row(
    row: pd.Series, prefix: str, metric: MetricSettingsForStatsEngine
) -> TestStatistic:
    if metric.statistic_type == "quantile_event":
        if metric.quantile_value is None:
            raise ValueError("quantile_value must be set for quantile_event metric")
        return QuantileClusteredStatistic(
            n=row[f"{prefix}_quantile_n"],
            n_star=row[f"{prefix}_quantile_nstar"],
            nu=metric.quantile_value,
            quantile_hat=row[f"{prefix}_quantile"],
            quantile_lower=row[f"{prefix}_quantile_lower"],
            quantile_upper=row[f"{prefix}_quantile_upper"],
            main_sum=row[f"{prefix}_main_sum"],
            main_sum_squares=row[f"{prefix}_main_sum_squares"],
            denominator_sum=row[f"{prefix}_denominator_sum"],
            denominator_sum_squares=row[f"{prefix}_denominator_sum_squares"],
            main_denominator_sum_product=row[f"{prefix}_main_denominator_sum_product"],
            n_clusters=row[f"{prefix}_users"],
        )
    elif metric.statistic_type == "quantile_unit":
        if metric.quantile_value is None:
            raise ValueError("quantile_value must be set for quantile_unit metric")
        return QuantileStatistic(
            n=row[f"{prefix}_quantile_n"],
            n_star=row[f"{prefix}_quantile_nstar"],
            nu=metric.quantile_value,
            quantile_hat=row[f"{prefix}_quantile"],
            quantile_lower=row[f"{prefix}_quantile_lower"],
            quantile_upper=row[f"{prefix}_quantile_upper"],
        )
    elif metric.statistic_type == "ratio":
        return RatioStatistic(
            m_statistic=base_statistic_from_metric_row(
                row, prefix, "main", metric.main_metric_type
            ),
            d_statistic=base_statistic_from_metric_row(
                row, prefix, "denominator", metric.denominator_metric_type
            ),
            m_d_sum_of_products=row[f"{prefix}_main_denominator_sum_product"],
            n=row[f"{prefix}_users"],
        )
    elif metric.statistic_type == "mean":
        return base_statistic_from_metric_row(
            row, prefix, "main", metric.main_metric_type
        )
    elif metric.statistic_type == "mean_ra":
        return RegressionAdjustedStatistic(
            post_statistic=base_statistic_from_metric_row(
                row, prefix, "main", metric.main_metric_type
            ),
            pre_statistic=base_statistic_from_metric_row(
                row, prefix, "covariate", metric.covariate_metric_type
            ),
            post_pre_sum_of_products=row[f"{prefix}_main_covariate_sum_product"],
            n=row[f"{prefix}_users"],
            # Theta will be overriden with correct value later
            theta=0,
        )
    else:
        raise ValueError(f"Unexpected statistic_type: {metric.statistic_type}")


def base_statistic_from_metric_row(
    row: pd.Series, prefix: str, component: str, metric_type: Optional[MetricType]
) -> Union[ProportionStatistic, SampleMeanStatistic]:
    if metric_type:
        if metric_type == "binomial":
            return ProportionStatistic(
                sum=row[f"{prefix}_{component}_sum"], n=row[f"{prefix}_count"]
            )
        elif metric_type == "count":
            return SampleMeanStatistic(
                sum=row[f"{prefix}_{component}_sum"],
                sum_squares=row[f"{prefix}_{component}_sum_squares"],
                n=row[f"{prefix}_count"],
            )
        else:
            raise ValueError(f"Unexpected metric_type: {metric_type}")
    else:
        raise ValueError("Unexpectedly metric_type was None")


# Run a specific analysis given data and configuration settings
def process_analysis(
    rows: pd.DataFrame,
    var_id_map: VarIdMap,
    metric: MetricSettingsForStatsEngine,
    analysis: AnalysisSettingsForStatsEngine,
) -> pd.DataFrame:
    # diff data, convert raw sql into df of dimensions, and get rid of extra dimensions
    var_names = analysis.var_names
    max_dimensions = analysis.max_dimensions

    # If we're doing a daily time series, we need to diff the data
    if analysis.dimension == "pre:datedaily":
        rows = diff_for_daily_time_series(rows)

    # Convert raw SQL result into a dataframe of dimensions
    df = get_metric_df(
        rows=rows,
        var_id_map=var_id_map,
        var_names=var_names,
        bandit=False,
    )
    # Limit to the top X dimensions with the most users
    # not possible to just re-sum for quantile metrics,
    # so we throw away "other" dimension
    reduced = reduce_dimensionality(
        df=df,
        max=max_dimensions,
        keep_other=metric.statistic_type not in ["quantile_event", "quantile_unit"],
    )
    # Run the analysis for each variation and dimension
    result = analyze_metric_df(
        df=reduced,
        metric=metric,
        analysis=analysis,
    )
    return result


def get_var_id_map(var_ids: List[str]) -> VarIdMap:
    return {v: i for i, v in enumerate(var_ids)}


def process_single_metric(
    rows: ExperimentMetricQueryResponseRows,
    metric: MetricSettingsForStatsEngine,
    analyses: List[AnalysisSettingsForStatsEngine],
) -> ExperimentMetricAnalysis:
    # If no data return blank results
    if len(rows) == 0:
        return ExperimentMetricAnalysis(
            metric=metric.id,
            analyses=[
                ExperimentMetricAnalysisResult(
                    unknownVariations=[],
                    dimensions=[],
                    multipleExposures=0,
                )
                for _ in analyses
            ],
        )
    pdrows = pd.DataFrame(rows)
    # TODO validate data in rows matches metric settings

    # Detect any variations that are not in the returned metric rows
    all_var_ids: Set[str] = set([v for a in analyses for v in a.var_ids])
    unknown_var_ids = detect_unknown_variations(rows=pdrows, var_ids=all_var_ids)

    results = [
        format_results(
            process_analysis(
                rows=pdrows,
                var_id_map=get_var_id_map(a.var_ids),
                metric=metric,
                analysis=a,
            ),
            baseline_index=a.baseline_index,
        )
        for a in analyses
    ]
    return ExperimentMetricAnalysis(
        metric=metric.id,
        analyses=[
            ExperimentMetricAnalysisResult(
                unknownVariations=list(unknown_var_ids),
                dimensions=r,
                multipleExposures=0,
            )
            for r in results
        ],
    )


def create_bandit_statistics(
    reduced: pd.DataFrame, metric: MetricSettingsForStatsEngine
) -> Dict[int, List[BanditStatistic]]:
    num_variations = reduced.at[0, "variations"]

    def create_test_statistics_single_period(
        s: pd.Series,
    ) -> Optional[List[BanditStatistic]]:
        s0 = variation_statistic_from_metric_row(
            row=s, prefix="baseline", metric=metric
        )
        if isinstance(s0, BanditStatistic):
            stats = [s0]
            for i in range(1, num_variations):
                s1 = variation_statistic_from_metric_row(
                    row=s, prefix=f"v{i}", metric=metric
                )
                # overwrites weights only if test statistics are of correct type
                if isinstance(s1, BanditStatistic):
                    stats.append(s1)
                else:
                    return None
            return stats
        else:
            return None

    num_periods = reduced.shape[0]
    period_sample_mean_stats = {}
    for i in range(num_periods):
        period_sample_mean_stats[i] = create_test_statistics_single_period(
            reduced.iloc[i, :]
        )
    return period_sample_mean_stats


def preprocess_bandits(
    rows: ExperimentMetricQueryResponseRows,
    metric: MetricSettingsForStatsEngine,
    settings: BanditSettingsForStatsEngine,
    dimension: str,
) -> Union[Bandits, BanditsCuped, BanditsRatio]:
    if len(rows) == 0:
        bandit_stats = {}
    else:
        pdrows = pd.DataFrame(rows)
        pdrows = pdrows.loc[pdrows["dimension"] == dimension]
        # convert raw sql into df of periods, and output df where n_rows = periods
        df = get_metric_df(
            rows=pdrows,
            var_id_map=get_var_id_map(settings.var_ids),
            var_names=settings.var_names,
            bandit=True,
        )
        bandit_stats = create_bandit_statistics(df, metric)
    bandit_prior = GaussianPrior(mean=0, variance=float(1e4), proper=True)
    bandit_config = BanditConfig(
        prior_distribution=bandit_prior,
        bandit_weights_seed=settings.bandit_weights_seed,
        weight_by_period=settings.weight_by_period,
        top_two=settings.top_two,
        alpha=settings.alpha,
    )
    if metric.statistic_type == "ratio":
        return BanditsRatio(bandit_stats, bandit_config)
    elif metric.statistic_type == "mean_ra":
        return BanditsCuped(bandit_stats, bandit_config)
    else:
        return Bandits(bandit_stats, bandit_config)


def get_weighted_rows(
    rows: ExperimentMetricQueryResponseRows,
    metric: MetricSettingsForStatsEngine,
    settings: List[AnalysisSettingsForStatsEngine],
    bandit_settings: BanditSettingsForStatsEngine,
) -> ExperimentMetricQueryResponseRows:
    weighted_rows = []
    unique_dimensions = list(set(setting.dimension for setting in settings))
    for dimension in unique_dimensions:
        b = preprocess_bandits(rows, metric, bandit_settings, dimension)
        if b.stats:
            for index, variation in enumerate(settings[0].var_ids):
                weighted_rows.append(b.make_row(dimension, index, variation))
    return weighted_rows


def get_bandit_response(
    rows: ExperimentMetricQueryResponseRows,
    metric: MetricSettingsForStatsEngine,
    settings: BanditSettingsForStatsEngine,
) -> BanditResult:
    b = preprocess_bandits(rows, metric, settings, "")
    if b:
        if any(value is None for value in b.stats.values()):
            error_str = "not all statistics are instance of type BanditStatistic"
            return BanditResult(
                singleVariationResults=None,
                banditWeights=None,
                bestArmProbabilities=None,
                additionalReward=None,
                seed=0,
                banditUpdateMessage=error_str,
            )
        bandit_result = b.compute_result()
        single_variation_results = None
        if (
            bandit_result.bandit_update_message == "successfully_updated"
            and bandit_result.ci
        ):
            single_variation_results = [
                SingleVariationResult(n, mn, ci)
                for n, mn, ci in zip(
                    b.variation_counts, b.variation_means, bandit_result.ci
                )
            ]
        return BanditResult(
            singleVariationResults=single_variation_results,
            banditWeights=bandit_result.bandit_weights,
            bestArmProbabilities=bandit_result.best_arm_probabilities,
            additionalReward=bandit_result.additional_reward,
            seed=bandit_result.seed,
            banditUpdateMessage=bandit_result.bandit_update_message,
        )
    else:  # empty dict
        return BanditResult(
            singleVariationResults=None,
            banditWeights=None,
            bestArmProbabilities=None,
            additionalReward=None,
            seed=0,
            banditUpdateMessage="no rows",
        )


# Get just the columns for a single metric
def filter_query_rows(
    query_rows: ExperimentMetricQueryResponseRows, metric_index: int
) -> ExperimentMetricQueryResponseRows:
    prefix = f"m{metric_index}_"
    return [
        {
            k.replace(prefix, ""): v
            for (k, v) in r.items()
            if k.startswith(prefix) or not re.match(r"^m\d+_", k)
        }
        for r in query_rows
    ]


def process_data_dict(data: Dict[str, Any]) -> DataForStatsEngine:
    return DataForStatsEngine(
        metrics={
            k: MetricSettingsForStatsEngine(**v) for k, v in data["metrics"].items()
        },
        analyses=[AnalysisSettingsForStatsEngine(**a) for a in data["analyses"]],
        query_results=[QueryResultsForStatsEngine(**q) for q in data["query_results"]],
        bandit_settings=(
            BanditSettingsForStatsEngine(**data["bandit_settings"])
            if "bandit_settings" in data
            else None
        ),
    )


def process_experiment_results(
    data: Dict[str, Any]
) -> Tuple[List[ExperimentMetricAnalysis], Optional[BanditResult]]:
    d = process_data_dict(data)
    results: List[ExperimentMetricAnalysis] = []
    bandit_result: Optional[BanditResult] = None
    for query_result in d.query_results:
        for i, metric in enumerate(query_result.metrics):
            if metric in d.metrics:
                rows = filter_query_rows(query_result.rows, i)
                if len(rows):
                    if d.bandit_settings:
                        if metric == d.bandit_settings.decision_metric:
                            if bandit_result is not None:
                                raise ValueError("Bandit weights already computed")
                            bandit_result = get_bandit_response(
                                rows=rows,
                                metric=d.metrics[metric],
                                settings=d.bandit_settings,
                            )
                        weighted_rows = get_weighted_rows(
                            rows, d.metrics[metric], d.analyses, d.bandit_settings
                        )
                        results.append(
                            process_single_metric(
                                rows=weighted_rows,
                                metric=d.metrics[metric],
                                analyses=d.analyses,
                            )
                        )
                    else:
                        results.append(
                            process_single_metric(
                                rows=rows,
                                metric=d.metrics[metric],
                                analyses=d.analyses,
                            )
                        )
    return results, bandit_result


def process_multiple_experiment_results(
    data: List[Dict[str, Any]]
) -> List[MultipleExperimentMetricAnalysis]:
    results: List[MultipleExperimentMetricAnalysis] = []
    for exp_data in data:
        try:
            exp_data_proc = ExperimentDataForStatsEngine(**exp_data)
            fixed_results, bandit_result = process_experiment_results(
                exp_data_proc.data
            )
            results.append(
                MultipleExperimentMetricAnalysis(
                    id=exp_data_proc.id,
                    results=fixed_results,
                    banditResult=bandit_result,
                    error=None,
                )
            )
        except Exception as e:
            results.append(
                MultipleExperimentMetricAnalysis(
                    id=exp_data["id"],
                    results=[],
                    banditResult=None,
                    error=str(e)[:64],
                )
            )
    return results
