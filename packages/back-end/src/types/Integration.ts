import { BigQueryTimestamp } from "@google-cloud/bigquery";
import { ExperimentMetricInterface } from "shared/experiments";
import { MetricAnalysisSettings } from "back-end/types/metric-analysis";
import { ReqContext } from "back-end/types/organization";
import {
  AutoFactTableSchemas,
  DataSourceInterface,
  DataSourceProperties,
  SchemaFormat,
} from "back-end/types/datasource";
import { DimensionInterface } from "back-end/types/dimension";
import { ExperimentSnapshotSettings } from "back-end/types/experiment-snapshot";
import { MetricInterface, MetricType } from "back-end/types/metric";
import { QueryStatistics } from "back-end/types/query";
import { SegmentInterface } from "back-end/types/segment";
import { FormatDialect } from "back-end/src/util/sql";
import { TemplateVariables } from "back-end/types/sql";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
  MetricQuantileSettings,
} from "back-end/types/fact-table";

export type ExternalIdCallback = (id: string) => Promise<void>;

export class MissingDatasourceParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingDatasourceParamsError";
  }
}

export class DataSourceNotSupportedError extends Error {
  constructor() {
    super("This data source is not supported yet.");
    this.name = "DataSourceNotSupportedError";
  }
}

export type MetricAggregationType = "pre" | "post" | "noWindow";

export type FactMetricData = {
  alias: string;
  id: string;
  metric: ExperimentMetricInterface;
  ratioMetric: boolean;
  funnelMetric: boolean;
  quantileMetric: "" | MetricQuantileSettings["type"];
  metricQuantileSettings: MetricQuantileSettings;
  regressionAdjusted: boolean;
  regressionAdjustmentHours: number;
  overrideConversionWindows: boolean;
  isPercentileCapped: boolean;
  capCoalesceMetric: string;
  capCoalesceDenominator: string;
  capCoalesceCovariate: string;
  minMetricDelay: number;
  raMetricSettings: {
    hours: number;
    minDelay: number;
    alias: string;
  };
  metricStart: Date;
  metricEnd: Date | null;
  maxHoursToConvert: number;
};

export type FactTableData = {
  metricData: FactMetricData[];
  idTypes: string[];
  metrics: FactMetricInterface[];
  metricEnd: Date | null;
  metricStart: Date;
  percentileData: {
    valueCol: string;
    outputCol: string;
    percentile: number;
    ignoreZeros: boolean;
  }[];
}

export type BanditMetricData = Pick<
  FactMetricData,
  | "alias"
  | "id"
  | "ratioMetric"
  | "regressionAdjusted"
  | "isPercentileCapped"
  | "capCoalesceMetric"
  | "capCoalesceDenominator"
  | "capCoalesceCovariate"
>;

export interface ExperimentMetricStats {
  metric_type: MetricType;
  count: number;
  main_sum: number;
  main_sum_squares: number;
}

export type VariationMetricResult = ExperimentMetricStats & {
  metric: string;
};

export type ExperimentResults = {
  dimensions: {
    dimension: string;
    variations: {
      variation: number;
      users: number;
      metrics: {
        [key: string]: ExperimentMetricStats;
      };
    }[];
  }[];
  unknownVariations: string[];
  multipleExposures?: number;
};

export type ExperimentQueryResponses = {
  dimension: string;
  variation: string;
  users: number;
  metrics: VariationMetricResult[];
}[];

export type UserDimension = {
  type: "user";
  dimension: DimensionInterface;
};
export type ExperimentDimension = {
  type: "experiment";
  id: string;
  specifiedSlices?: string[];
};
export type DateDimension = {
  type: "date";
};

export type DateCumulativeDimension = {
  type: "datecumulative";
};
export type DateDailyDimension = {
  type: "datedaily";
};
export type ActivationDimension = {
  type: "activation";
};
export type Dimension =
  | UserDimension
  | ExperimentDimension
  | DateDimension
  | DateCumulativeDimension
  | DateDailyDimension
  | ActivationDimension;

export type ProcessedDimensions = {
  unitDimensions: UserDimension[];
  experimentDimensions: ExperimentDimension[];
  activationDimension: ActivationDimension | null;
};

export interface DropTableQueryParams {
  fullTablePath: string;
}

export type TestQueryParams = {
  query: string;
  templateVariables?: TemplateVariables;
  testDays?: number;
  limit?: number;
};

export type ColumnTopValuesParams = {
  factTable: Pick<FactTableInterface, "sql" | "eventName">;
  column: ColumnInterface;
  limit?: number;
};
export type ColumnTopValuesResponseRow = {
  value: string;
  count: number;
};

interface ExperimentBaseQueryParams {
  settings: ExperimentSnapshotSettings;
  activationMetric: ExperimentMetricInterface | null;
  factTableMap: FactTableMap;
  dimensions: Dimension[];
  segment: SegmentInterface | null;
  unitsTableFullName?: string;
}

export interface ExperimentUnitsQueryParams extends ExperimentBaseQueryParams {
  includeIdJoins: boolean;
}

export interface ExperimentMetricQueryParams extends ExperimentBaseQueryParams {
  metric: ExperimentMetricInterface;
  denominatorMetrics: ExperimentMetricInterface[];
  useUnitsTable: boolean;
}

export interface ExperimentFactMetricsQueryParams
  extends ExperimentBaseQueryParams {
  metrics: FactMetricInterface[];
  useUnitsTable: boolean;
}

export interface ExperimentPipelineFactMetricsParams extends ExperimentBaseQueryParams {
  tableName: string;
  lookbackDate: Date;
  metricGroups: FactMetricInterface[][];
}

export interface ExperimentAggregateUnitsQueryParams
  extends ExperimentBaseQueryParams {
  useUnitsTable: boolean;
}

export interface ExperimentPipelineCreateMetricsParams {
  tableName: string;
  factMetricParams: ExperimentPipelineFactMetricsParams[];
}

export interface ExperimentPipelineTrimMetricsParams {
  tableName: string;
  lookbackDate: Date;
}

export interface ExperimentPipelineUnitsParams
  extends ExperimentBaseQueryParams {
  lookbackDate: Date;
}

export type DimensionSlicesQueryParams = {
  exposureQueryId: string;
  dimensions: ExperimentDimension[];
  lookbackDays: number;
};

export type PastExperimentParams = {
  from: Date;
  forceRefresh?: boolean;
};

export type MetricValueParams = {
  from: Date;
  to: Date;
  metric: MetricInterface;
  name: string;
  factTableMap: FactTableMap;
  segment?: SegmentInterface;
  includeByDate?: boolean;
};

export type MetricAnalysisParams = {
  settings: MetricAnalysisSettings;
  metric: FactMetricInterface;
  factTableMap: FactTableMap;
  segment: SegmentInterface | null;
};

export type MetricValueResultDate = {
  date: string;
  count: number;
  mean: number;
  stddev: number;
};

export type MetricValueResult = {
  count: number;
  stddev: number;
  mean: number;
  dates?: MetricValueResultDate[];
};

export type PastExperimentResult = {
  mergeResults: boolean;
  experiments: {
    exposureQueryId: string;
    experiment_id: string;
    experiment_name?: string;
    variation_id: string;
    variation_name?: string;
    start_date: Date;
    end_date: Date;
    users: number;
    latest_data: Date;
    start_of_range: boolean;
  }[];
};

// NOTE: response rows must all be lower case to work across SQL integrations
export type TrackedEventResponseRow = {
  event: string;
  display_name: string;
  has_user_id: boolean;
  count: number;
  last_tracked_at: Date | BigQueryTimestamp;
};

export interface TrackedEventData {
  eventName: string;
  displayName: string;
  hasUserId: boolean;
  count: number;
  lastTrackedAt: Date;
}

export type AutoMetricToCreate = {
  name: string;
  sql: string;
  type: MetricType;
  shouldCreate: boolean;
  alreadyExists: boolean;
  userIdTypes: string[];
};

export interface AutoMetricTrackedEvent extends TrackedEventData {
  metricsToCreate: AutoMetricToCreate[];
}

export type MetricValueQueryResponseRow = {
  date: string;
  count: number;
  main_sum: number;
  main_sum_squares: number;
};

export type MetricValueQueryResponseRows = MetricValueQueryResponseRow[];

export type MetricAnalysisQueryResponseRow = {
  date: string;
  data_type: string;
  capped: boolean;
  units: number;
  main_sum: number;
  main_sum_squares: number;
  denominator_sum?: number;
  denominator_sum_squares?: number;
  main_denominator_sum_product?: number;

  value_min?: number;
  value_max?: number;
  bin_width?: number;
  units_bin_0?: number;
  units_bin_1?: number;
  units_bin_2?: number;
  units_bin_3?: number;
  units_bin_4?: number;
  units_bin_5?: number;
  units_bin_6?: number;
  units_bin_7?: number;
  units_bin_8?: number;
  units_bin_9?: number;
  units_bin_10?: number;
  units_bin_11?: number;
  units_bin_12?: number;
  units_bin_13?: number;
  units_bin_14?: number;
  units_bin_15?: number;
  units_bin_16?: number;
  units_bin_17?: number;
  units_bin_18?: number;
  units_bin_19?: number;
  units_bin_20?: number;
  units_bin_21?: number;
  units_bin_22?: number;
  units_bin_23?: number;
  units_bin_24?: number;
};

export type MetricAnalysisQueryResponseRows = MetricAnalysisQueryResponseRow[];

export type PastExperimentResponseRows = {
  exposure_query: string;
  experiment_id: string;
  experiment_name?: string;
  variation_id: string;
  variation_name?: string;
  start_date: string;
  end_date: string;
  users: number;
  latest_data: string;
}[];

export type ExperimentMetricQueryResponseRows = {
  dimension: string;
  variation: string;
  users: number;
  count: number;
  main_cap_value?: number;
  main_sum: number;
  main_sum_squares: number;
  denominator_cap_value?: number;
  denominator_sum?: number;
  denominator_sum_squares?: number;
  main_denominator_sum_product?: number;
  covariate_sum?: number;
  covariate_sum_squares?: number;
  main_covariate_sum_product?: number;

  theta?: number; // for bandits only

  quantile?: number;
  quantile_n?: number;
  quantile_lower?: number;
  quantile_upper?: number;
  quantile_nstar?: number;
}[];

export type ExperimentFactMetricsQueryResponseRows = {
  dimension: string;
  variation: string;
  users: number;
  count: number;
  [key: string]: number | string;
}[];

export type ExperimentAggregateUnitsQueryResponseRows = {
  variation: string;
  dimension_value: string;
  dimension_name: string;
  units: number;
}[];

export type DimensionSlicesQueryResponseRows = {
  dimension_value: string;
  dimension_name: string;
  units: number;
  total_units: number;
}[];

// eslint-disable-next-line
export type QueryResponse<Rows = Record<string, any>[]> = {
  rows: Rows;
  statistics?: QueryStatistics;
};

export type MetricValueQueryResponse = QueryResponse<MetricValueQueryResponseRows>;
export type MetricAnalysisQueryResponse = QueryResponse<MetricAnalysisQueryResponseRows>;
export type PastExperimentQueryResponse = QueryResponse<PastExperimentResponseRows>;
export type ExperimentMetricQueryResponse = QueryResponse<ExperimentMetricQueryResponseRows>;
export type ExperimentFactMetricsQueryResponse = QueryResponse<ExperimentFactMetricsQueryResponseRows>;
export type EmptyQueryResponse = QueryResponse;
export type ExperimentAggregateUnitsQueryResponse = QueryResponse<ExperimentAggregateUnitsQueryResponseRows>;
export type DimensionSlicesQueryResponse = QueryResponse<DimensionSlicesQueryResponseRows>;
export type ColumnTopValuesResponse = QueryResponse<
  ColumnTopValuesResponseRow[]
>;

export interface TestQueryRow {
  [key: string]: unknown;
}

export interface TestQueryResult {
  results: TestQueryRow[];
  duration: number;
}

export interface RawInformationSchema {
  table_name: string;
  table_catalog: string;
  table_schema: string;
  column_count: string;
}

export interface Column {
  columnName: string;
  path?: string;
  dataType: string;
}

export interface Table {
  tableName: string;
  path: string;
  id: string;
  numOfColumns: number;
  dateCreated: Date;
  dateUpdated: Date;
}

export interface Schema {
  schemaName: string;
  tables: Table[];
  path?: string;
  dateCreated: Date;
  dateUpdated: Date;
}

export interface InformationSchema {
  databaseName: string;
  path?: string;
  schemas: Schema[];
  dateCreated: Date;
  dateUpdated: Date;
}

export interface InformationSchemaError {
  errorType: "generic" | "not_supported" | "missing_params";
  message: string;
}

export interface InformationSchemaInterface {
  id: string;
  datasourceId: string;
  databases: InformationSchema[];
  organization: string;
  status: "PENDING" | "COMPLETE";
  refreshMS: number;
  error?: InformationSchemaError | null;
  dateCreated: Date;
  dateUpdated: Date;
}

export interface InformationSchemaTablesInterface {
  id: string;
  datasourceId: string;
  organization: string;
  tableName: string;
  tableSchema: string;
  databaseName: string;
  columns: Column[];
  refreshMS: number;
  dateCreated: Date;
  dateUpdated: Date;
  informationSchemaId: string;
}

export interface SourceIntegrationInterface {
  datasource: DataSourceInterface;
  context: ReqContext;
  decryptionError: boolean;
  // eslint-disable-next-line
  params: any;
  getSensitiveParamKeys(): string[];
  getExperimentResultsQuery(
    snapshotSettings: ExperimentSnapshotSettings,
    metricDocs: ExperimentMetricInterface[],
    activationMetricDoc: ExperimentMetricInterface | null,
    dimension: DimensionInterface | null
  ): string;
  getFormatDialect?(): FormatDialect;
  getExperimentResults(
    snapshotSettings: ExperimentSnapshotSettings,
    metrics: ExperimentMetricInterface[],
    activationMetric: ExperimentMetricInterface | null,
    dimension: DimensionInterface | null
  ): Promise<ExperimentQueryResponses>;
  getSourceProperties(): DataSourceProperties;
  testConnection(): Promise<boolean>;
  getTableData?(
    databaseName: string,
    tableSchema: string,
    tableName: string
  ): Promise<{ tableData: null | unknown[] }>;
  getInformationSchema?(): Promise<InformationSchema[]>;
  getTestValidityQuery?(
    query: string,
    templateVariables?: TemplateVariables
  ): string;
  getTestQuery?(params: TestQueryParams): string;
  runTestQuery?(
    sql: string,
    timestampCols?: string[]
  ): Promise<TestQueryResult>;
  getMetricAnalysisQuery(params: MetricAnalysisParams): string;
  runMetricAnalysisQuery(
    query: string,
    setExternalId: ExternalIdCallback
  ): Promise<MetricAnalysisQueryResponse>;
  getDropUnitsTableQuery(params: DropTableQueryParams): string;
  runDropTableQuery(
    query: string,
    setExternalId: ExternalIdCallback
  ): Promise<EmptyQueryResponse>;
  getMetricValueQuery(params: MetricValueParams): string;
  getExperimentFactMetricsQuery?(
    params: ExperimentFactMetricsQueryParams
  ): string;
  getExperimentMetricQuery(params: ExperimentMetricQueryParams): string;
  getExperimentAggregateUnitsQuery(
    params: ExperimentAggregateUnitsQueryParams
  ): string;
  getExperimentUnitsTableQuery(params: ExperimentUnitsQueryParams): string;
  getPastExperimentQuery(params: PastExperimentParams): string;
  getDimensionSlicesQuery(params: DimensionSlicesQueryParams): string;
  runDimensionSlicesQuery(
    query: string,
    setExternalId: ExternalIdCallback
  ): Promise<DimensionSlicesQueryResponse>;
  runMetricValueQuery(
    query: string,
    setExternalId: ExternalIdCallback
  ): Promise<MetricValueQueryResponse>;
  runExperimentMetricQuery(
    query: string,
    setExternalId: ExternalIdCallback
  ): Promise<ExperimentMetricQueryResponse>;
  runExperimentFactMetricsQuery?(
    query: string,
    setExternalId: ExternalIdCallback
  ): Promise<ExperimentFactMetricsQueryResponse>;
  runExperimentAggregateUnitsQuery(
    query: string,
    setExternalId: ExternalIdCallback
  ): Promise<ExperimentAggregateUnitsQueryResponse>;
  runExperimentUnitsQuery(
    query: string,
    setExternalId: ExternalIdCallback
  ): Promise<EmptyQueryResponse>;
  runPastExperimentQuery(
    query: string,
    setExternalId: ExternalIdCallback
  ): Promise<PastExperimentQueryResponse>;
  runColumnTopValuesQuery?(sql: string): Promise<ColumnTopValuesResponse>;
  getColumnTopValuesQuery?: (params: ColumnTopValuesParams) => string;
  getEventsTrackedByDatasource?: (
    schemaFormat: AutoFactTableSchemas,
    schema?: string
  ) => Promise<TrackedEventData[]>;
  getAutoMetricsToCreate?: (
    existingMetrics: MetricInterface[],
    schema: string
  ) => Promise<AutoMetricTrackedEvent[]>;
  getAutoGeneratedMetricSqlQuery?(
    event: string,
    hasUserId: boolean,
    schemaFormat: SchemaFormat,
    type: MetricType
  ): string;
  generateTablePath?(
    tableName: string,
    schema?: string,
    database?: string,
    requireSchema?: boolean
  ): string;
  cancelQuery?(externalId: string): Promise<void>;
  // Pipeline Incremental Refresh queries
  getExperimentPipelineCreateUnitsQuery(
    params: ExperimentPipelineUnitsParams
  ): string;
  runExperimentPipelineCreateUnitsQuery(
    query: string,
    setExternalId: ExternalIdCallback
  ): Promise<EmptyQueryResponse>;
  getExperimentPipelineUnitsQuery(
    params: ExperimentPipelineUnitsParams
  ): string;
  runExperimentPipelineUnitsQuery(
    query: string,
    setExternalId: ExternalIdCallback
  ): Promise<EmptyQueryResponse>;
  getExperimentPipelineTrimMetricsQuery(
    params: ExperimentPipelineTrimMetricsParams
  ): string;
  runExperimentPipelineTrimMetricsQuery(
    query: string,
    setExternalId: ExternalIdCallback
  ): Promise<EmptyQueryResponse>;
  getExperimentPipelineFactMetricsQuery(
    params: ExperimentPipelineFactMetricsParams
  ): string;
  runExperimentPipelineFactMetricsQuery(
    query: string,
    setExternalId: ExternalIdCallback
  ): Promise<EmptyQueryResponse>;
  getExperimentPipelineStatisticsQuery(
    params: ExperimentPipelineFactMetricsParams
  ): string;
  runExperimentPipelineStatisticsQuery(
    query: string,
    setExternalId: ExternalIdCallback
  ): Promise<ExperimentFactMetricsQueryResponse>;
}
