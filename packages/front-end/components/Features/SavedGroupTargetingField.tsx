import { SavedGroupTargeting } from "back-end/types/feature";
import { FaMinusCircle, FaPlusCircle } from "react-icons/fa";
import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { SMALL_GROUP_SIZE_LIMIT } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField, { isSingleValue } from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import LargeSavedGroupSupportWarning, {
  useLargeSavedGroupSupport,
} from "@/components/SavedGroups/LargeSavedGroupSupportWarning";
import Tooltip from "@/components/Tooltip/Tooltip";

export interface Props {
  value: SavedGroupTargeting[];
  setValue: (savedGroups: SavedGroupTargeting[]) => void;
  project: string;
  setSavedGroupTargetingSdkIssues: (
    savedGroupTargetingSdkIssues: boolean
  ) => void;
}

export default function SavedGroupTargetingField({
  value,
  setValue,
  project,
  setSavedGroupTargetingSdkIssues,
}: Props) {
  const { savedGroups, getSavedGroupById } = useDefinitions();

  const {
    supportedConnections,
    unsupportedConnections,
    unversionedConnections,
    hasLargeSavedGroupFeature,
  } = useLargeSavedGroupSupport(project);

  const largeSavedGroups = useMemo(
    () =>
      new Set(
        savedGroups
          .filter((savedGroup) => savedGroup?.passByReferenceOnly)
          .map((group) => group.id)
      ),
    [savedGroups]
  );

  const selectedLargeSavedGroups = useMemo(
    () =>
      value
        .flatMap((savedGroupTargeting) => savedGroupTargeting.ids)
        .filter((sgid) => largeSavedGroups.has(sgid)),
    [value, largeSavedGroups]
  );

  const [localTargetingIssues, setLocalTargetingIssues] = useState(false);

  useEffect(() => {
    if (
      selectedLargeSavedGroups.length > 0 &&
      supportedConnections.length === 0 &&
      unversionedConnections.length === 0
    ) {
      setSavedGroupTargetingSdkIssues(true);
      setLocalTargetingIssues(true);
    } else {
      setSavedGroupTargetingSdkIssues(false);
      setLocalTargetingIssues(false);
    }
  }, [
    selectedLargeSavedGroups,
    supportedConnections,
    unversionedConnections,
    setSavedGroupTargetingSdkIssues,
  ]);

  if (!savedGroups.length) return null;

  const options = savedGroups.map((s) => ({
    value: s.id,
    label: s.groupName,
  }));

  const conflicts = getSavedGroupTargetingConflicts(value);

  if (value.length === 0) {
    return (
      <div>
        <div className="font-italic text-muted mr-3">
          No saved group targeting applied.
        </div>
        <div
          className="d-inline-block ml-1 mt-2 link-purple font-weight-bold cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            setValue([
              ...value,
              {
                match: "any",
                ids: [],
              },
            ]);
          }}
        >
          <FaPlusCircle className="mr-1" />
          Add group targeting
        </div>
      </div>
    );
  }

  return (
    <div className="form-group my-4">
      <label>Target by Saved Groups</label>
      {largeSavedGroups.size > 0 && (
        <div className="mb-1">
          <LargeSavedGroupSupportWarning
            type="targeting_rule"
            hasLargeSavedGroupFeature={hasLargeSavedGroupFeature}
            supportedConnections={supportedConnections}
            unsupportedConnections={unsupportedConnections}
            unversionedConnections={unversionedConnections}
            upgradeWarningToError={localTargetingIssues}
          />
        </div>
      )}
      <div>
        <div className="appbox bg-light px-3 py-3">
          {conflicts.length > 0 && (
            <div className="alert alert-danger">
              <strong>Error:</strong> You have a conflict in your rules with the
              following groups:{" "}
              {conflicts.map((c) => (
                <span key={c} className="badge badge-danger mr-1">
                  {getSavedGroupById(c)?.groupName || c}
                </span>
              ))}
            </div>
          )}
          {value.map((v, i) => {
            return (
              <div className="row align-items-center mb-3" key={i}>
                <div className="col-auto" style={{ width: 70 }}>
                  {i === 0 ? "In" : "AND"}
                </div>
                <div className="col-auto">
                  <SelectField
                    value={v.match}
                    onChange={(match) => {
                      const newValue = [...value];
                      newValue[i] = { ...v };
                      newValue[i].match = match as "all" | "any" | "none";
                      setValue(newValue);
                    }}
                    sort={false}
                    options={[
                      {
                        value: "any",
                        label: "Any of",
                      },
                      {
                        value: "all",
                        label: "All of",
                      },
                      {
                        value: "none",
                        label: "None of",
                      },
                    ]}
                  />
                </div>
                <div className="col">
                  <MultiSelectField
                    value={v.ids}
                    onChange={(ids) => {
                      const newValue = [...value];
                      newValue[i] = { ...v };
                      newValue[i].ids = ids;
                      setValue(newValue);
                    }}
                    options={options}
                    required
                    placeholder="Select groups..."
                    closeMenuOnSelect={true}
                    formatOptionLabel={({ value, label }, { context }) => {
                      const group = getSavedGroupById(value);
                      if (!group) return label;
                      const unsupported =
                        supportedConnections.length === 0 &&
                        unversionedConnections.length === 0 &&
                        !!group.passByReferenceOnly;
                      if (context === "value") {
                        if (unsupported) {
                          return `${label}*`;
                        }
                        return label;
                      }
                      return (
                        <div className={clsx(unsupported ? "disabled" : "")}>
                          {group.groupName}
                          {group.passByReferenceOnly && (
                            <span className="float-right">
                              <Tooltip
                                body={
                                  unsupportedConnections.length > 0
                                    ? `Lists with >${SMALL_GROUP_SIZE_LIMIT} items are not supported by one or more SDKs`
                                    : ""
                                }
                                tipPosition="top"
                              >
                                &gt;{SMALL_GROUP_SIZE_LIMIT} ITEMS
                              </Tooltip>
                            </span>
                          )}
                        </div>
                      );
                    }}
                    isOptionDisabled={(option) =>
                      supportedConnections.length === 0 &&
                      unversionedConnections.length === 0 &&
                      isSingleValue(option) &&
                      !!getSavedGroupById(option.value)?.passByReferenceOnly
                    }
                    customClassName={localTargetingIssues ? "error" : ""}
                  />
                </div>
                <div className="col-auto ml-auto">
                  <button
                    className="btn btn-link text-danger"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      const newValue = [...value];
                      newValue.splice(i, 1);
                      setValue(newValue);
                    }}
                  >
                    <FaMinusCircle className="mr-1" />
                    remove
                  </button>
                </div>
              </div>
            );
          })}
          <span
            className="link-purple font-weight-bold cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              setValue([
                ...value,
                {
                  match: "any",
                  ids: [],
                },
              ]);
            }}
          >
            <FaPlusCircle className="mr-1" />
            Add another condition
          </span>
        </div>
      </div>
    </div>
  );
}

export function getSavedGroupTargetingConflicts(
  savedGroups: SavedGroupTargeting[]
): string[] {
  const required = new Set<string>();
  const excluded = new Set<string>();
  savedGroups.forEach((rule) => {
    if (rule.match === "all" || rule.match === "any") {
      rule.ids.forEach((id) => required.add(id));
    } else if (rule.match === "none") {
      rule.ids.forEach((id) => excluded.add(id));
    }
  });

  // If there's an overlap between required and excluded groups, there's a conflict
  return Array.from(required).filter((id) => excluded.has(id));
}

export function validateSavedGroupTargeting(
  savedGroups?: SavedGroupTargeting[]
) {
  if (!savedGroups) return;

  if (savedGroups.some((g) => g.ids.length === 0)) {
    throw new Error("Cannot have empty Saved Group targeting rules.");
  }

  if (getSavedGroupTargetingConflicts(savedGroups).length > 0) {
    throw new Error(
      "Please fix conflicts in your Saved Group rules before saving"
    );
  }
}
