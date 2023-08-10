import { useState, useEffect, useCallback } from "react";
import { TrackedEventData } from "@/../back-end/src/types/Integration";
import {
  DataSourceInterfaceWithParams,
  DataSourceSettings,
} from "@/../back-end/types/datasource";
import { cloneDeep } from "lodash";
import { useForm } from "react-hook-form";
import { MetricType } from "@/../back-end/types/metric";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "./Button";
import { DocLink } from "./DocLink";
import Modal from "./Modal";
import Tooltip from "./Tooltip/Tooltip";
import AutoMetricCard from "./Settings/AutoMetricCard";
import SelectField from "./Forms/SelectField";
import LoadingOverlay from "./LoadingOverlay";

type Props = {
  setShowAutoGenerateMetricsModal: (show: boolean) => void;
  datasource?: DataSourceInterfaceWithParams;
  source: string;
  mutate: () => void;
};

export default function AutoGenerateMetricsModal({
  setShowAutoGenerateMetricsModal,
  datasource,
  source,
  mutate,
}: Props) {
  const [autoMetricError, setAutoMetricError] = useState("");
  const [trackedEvents, setTrackedEvents] = useState<TrackedEventData[]>([]);
  const { datasources } = useDefinitions();
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(false);
  const { getDatasourceById } = useDefinitions();

  const form = useForm<{
    datasourceId: string;
    settings: DataSourceSettings | undefined;
    metricsToCreate: {
      name: string;
      sql: string;
      type: MetricType;
    }[];
  }>({
    defaultValues: {
      datasourceId: datasource?.id || "",
      settings: datasource?.settings || {},
      metricsToCreate: [],
    },
  });

  const selectedDatasource =
    datasource || getDatasourceById(form.watch("datasourceId"));

  const submit = form.handleSubmit(async (data) => {
    track("Generating Auto Metrics For User", {
      autoMetricsCreated: {
        countMetrics: data.metricsToCreate.filter((m) => m.type === "count")
          .length,
        binomialMetrics: data.metricsToCreate.filter(
          (m) => m.type === "binomial"
        ).length,
      },
      source,
      type: selectedDatasource?.type,
      dataSourceId: selectedDatasource?.id,
      schema: selectedDatasource?.settings.schemaFormat,
    });

    const value = {
      datasourceId: selectedDatasource?.id,
      projects: selectedDatasource?.projects,
      metricsToCreate: data.metricsToCreate,
    };

    await apiCall(`/metrics/auto-metrics`, {
      method: "POST",
      body: JSON.stringify(value),
    });
    mutate();
  });

  const getTrackedEvents = useCallback(
    async (datasourceObj: DataSourceInterfaceWithParams | undefined) => {
      setAutoMetricError("");
      setTrackedEvents([]);
      if (
        !datasourceObj ||
        !datasourceObj?.properties?.supportsAutoGeneratedMetrics
      ) {
        return;
      }
      try {
        setLoading(true);
        track("Generate Auto Metrics CTA Clicked", {
          source,
          type: datasourceObj.type,
          dataSourceId: datasourceObj.id,
          schema: datasourceObj?.settings.schemaFormat,
          newDatasourceForm: true,
        });
        const res = await apiCall<{
          trackedEvents: TrackedEventData[];
          message?: string;
        }>(`/metrics/tracked-events/${datasourceObj.id}`);
        setLoading(false);
        if (res.message) {
          track("Generate Auto Metrics Error", {
            error: res.message,
            source,
            type: datasourceObj.type,
            dataSourceId: datasourceObj.id,
            schema: datasourceObj.settings.schemaFormat,
            newDatasourceForm: true,
          });
          setAutoMetricError(res.message);
          return;
        }
        // Before we setMetricsToCreate, we need to add a "shouldCreate" boolean property to each metric
        res.trackedEvents.forEach((event: TrackedEventData) => {
          event.metricsToCreate.forEach((metric) => {
            metric.shouldCreate = !metric.exists ? true : false;
          });
        });
        setTrackedEvents(res.trackedEvents);
      } catch (e) {
        track("Generate Auto Metrics Error", {
          error: e.message,
          source,
          type: datasourceObj.type,
          dataSourceId: datasourceObj.id,
          schema: datasourceObj.settings.schemaFormat,
          newDatasourceForm: true,
        });
        setAutoMetricError(e.message);
      }
    },
    [apiCall, source]
  );

  useEffect(() => {
    const updatedMetricsToCreate: {
      name: string;
      sql: string;
      type: MetricType;
    }[] = [];
    trackedEvents.forEach((event: TrackedEventData) => {
      event.metricsToCreate.forEach((metric) => {
        if (metric.shouldCreate) {
          updatedMetricsToCreate.push({
            name: metric.name,
            type: metric.type,
            sql: metric.sql,
          });
        }
      });
    });
    form.setValue("metricsToCreate", updatedMetricsToCreate);
  }, [form, trackedEvents]);

  useEffect(() => {
    if (!selectedDatasource) return;

    getTrackedEvents(selectedDatasource);
  }, [getTrackedEvents, selectedDatasource]);

  return (
    <Modal
      size="lg"
      open={true}
      header="Discover Metrics"
      close={() => setShowAutoGenerateMetricsModal(false)}
      submit={submit}
      cta={`Create Metric${
        form.watch("metricsToCreate").length === 1 ? "" : "s"
      }`}
      ctaEnabled={form.watch("metricsToCreate").length > 0}
    >
      <>
        <h4>Generate Metrics Automatically</h4>
        <p>
          Select a datasource below to see if we&apos;re able to generate
          metrics for you automatically, based on your tracked events.{" "}
          <DocLink docSection={"autoMetrics"}>Learn More</DocLink>
        </p>
        <SelectField
          label="Select A Data Source"
          value={selectedDatasource?.id || ""}
          onChange={(datasourceId) => {
            form.setValue("datasourceId", datasourceId);
          }}
          options={(datasources || []).map((d) => ({
            value: d.id,
            label: `${d.name}${d.description ? ` — ${d.description}` : ""}`,
          }))}
          className="portal-overflow-ellipsis"
          name="datasource"
          disabled={datasource ? true : false}
        />
        {loading ? <LoadingOverlay /> : null}
        {selectedDatasource &&
        !selectedDatasource?.properties?.supportsAutoGeneratedMetrics ? (
          <div className="alert alert-warning">
            Sorry - this data source does not support auto generated metrics.{" "}
            <DocLink docSection={"metrics"}>Learn More</DocLink>
          </div>
        ) : null}
        {trackedEvents.length > 0 ? (
          <div>
            <p className="alert alert-info">
              These are the tracked events we found that we can use to
              automatically generate the following metrics for you. And
              don&apos;t worry, you can always edit and remove these metrics at
              anytime after they&apos;re created.{" "}
              <DocLink docSection={"metrics"}>
                Click here to learn more about GrowthBook Metrics.
              </DocLink>
            </p>
            <div className="d-flex justify-content-end">
              <Button
                color="link"
                onClick={async () => {
                  const updates: TrackedEventData[] = cloneDeep(trackedEvents);
                  updates.forEach((event) => {
                    event.metricsToCreate.forEach((metric) => {
                      if (!metric.shouldCreate && !metric.exists) {
                        metric.shouldCreate = true;
                      }
                    });
                  });
                  setTrackedEvents(updates);
                }}
              >
                Check All
              </Button>
              <Button
                color="link"
                onClick={async () => {
                  const updates: TrackedEventData[] = cloneDeep(trackedEvents);
                  updates.forEach((event) => {
                    event.metricsToCreate.forEach((metric) => {
                      if (metric.shouldCreate && !metric.exists) {
                        metric.shouldCreate = false;
                      }
                    });
                  });
                  setTrackedEvents(updates);
                }}
              >
                Uncheck All
              </Button>
            </div>
            <table className="appbox table experiment-table gbtable">
              <thead>
                <tr>
                  <th>Event Name</th>
                  <th className="text-center">Count</th>
                  <th className="text-center">
                    <Tooltip body="Binomial metrics are simple yes/no conversions (E.G. Created Account)">
                      Create Binomial Metric
                    </Tooltip>
                  </th>
                  <th className="text-center">
                    {" "}
                    <Tooltip body="Count metrics sum conversion values per user (E.G. Pages per Visit)">
                      Create Count Metric
                    </Tooltip>
                  </th>
                </tr>
              </thead>
              <tbody>
                {trackedEvents.map((event, i) => {
                  return (
                    <AutoMetricCard
                      key={`${event}-${i}`}
                      event={event}
                      trackedEvents={trackedEvents}
                      setTrackedEvents={setTrackedEvents}
                      form={form}
                      i={i}
                      dataSourceId={selectedDatasource?.id || ""}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {autoMetricError && (
          <div className="alert alert-danger">{autoMetricError}</div>
        )}
      </>
    </Modal>
  );
}