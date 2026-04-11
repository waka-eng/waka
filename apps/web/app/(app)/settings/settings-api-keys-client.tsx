"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

import type { SettingsApiKeysData } from "../../../src/auth/api-key-settings-loader.ts";
import { StableControlLabel } from "../../../src/ui/stable-control-label.tsx";
import { submitSettingsApiKeyCreateForm, submitSettingsApiKeyRevoke } from "./actions.ts";
import {
  createSettingsApiKeyRevokeConfirmationMessage,
  createSettingsApiKeysCreateFormViewModel,
  createSettingsApiKeysSectionViewModel,
  SETTINGS_API_KEYS_CREATE_FORM_SUBMIT_PENDING_LABEL,
  SETTINGS_API_KEYS_MISSING_DESCRIPTION,
  SETTINGS_API_KEYS_REVOKE_ACTION_LABEL,
  SETTINGS_API_KEYS_REVOKE_ACTION_PENDING_LABEL,
  SETTINGS_API_KEYS_REVOKED_ACTION_LABEL,
  SETTINGS_API_KEYS_SECTION_DESCRIPTION,
  SETTINGS_API_KEYS_SECTION_TITLE,
  upsertSettingsApiKey,
} from "./settings-page-model.ts";

export interface SettingsApiKeysClientSectionProps {
  initialData: SettingsApiKeysData;
}

const settingsCardClassName =
  "waka-primary-section rounded-3xl border border-stone-200 bg-white shadow-[0_18px_50px_rgba(41,37,36,0.06)]";
const metadataListClassName =
  "mt-4 grid min-w-0 gap-3 text-sm text-stone-600 min-[56rem]:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]";
const createApiKeyFormClassName =
  "rounded-3xl border border-stone-200 bg-[#fcfaf6] p-5";
const createApiKeyInputClassName =
  "w-full min-w-0 max-w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/30";
const createApiKeyFieldClassName = "mt-4 grid min-w-0 gap-2";
const createApiKeyFieldSupportingTextClassName = "min-w-0 space-y-2";
const createApiKeyFieldLabelClassName =
  "block max-w-full whitespace-normal break-words text-xs font-semibold uppercase tracking-[0.24em] leading-5 text-stone-500";
const createApiKeyFieldHintClassName =
  "max-w-full whitespace-normal break-words text-xs leading-5 text-stone-500";
const createApiKeyFieldErrorClassName =
  "max-w-full whitespace-normal break-words text-sm leading-6 text-rose-700";
const createApiKeySubmitButtonClassName =
  "inline-flex min-h-11 w-full items-center justify-center rounded-full bg-stone-950 px-5 py-2.5 text-center text-sm font-semibold leading-5 whitespace-normal break-words text-white transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:cursor-not-allowed disabled:bg-stone-400 sm:w-auto";
const revokeApiKeyButtonClassName =
  "inline-flex min-h-11 w-full max-w-full items-center justify-center rounded-full border border-rose-200 px-4 py-2.5 text-center text-sm font-semibold leading-5 whitespace-normal break-words text-rose-700 transition hover:border-rose-300 hover:text-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70 disabled:cursor-not-allowed disabled:border-stone-200 disabled:text-stone-400 sm:w-auto";
const apiKeysListClassName =
  "grid min-w-0 gap-4 min-[56rem]:grid-cols-[repeat(auto-fit,minmax(22rem,1fr))] xl:grid-cols-[repeat(auto-fit,minmax(19rem,1fr))]";

function renderMetadataItem(label: string, value: string, key: string): ReactElement {
  return (
    <div
      key={key}
      className="rounded-2xl border border-stone-200 bg-white px-4 py-3"
    >
      <dt className="text-xs uppercase tracking-[0.24em] text-stone-500">{label}</dt>
      <dd className="mt-2 break-words text-sm font-medium text-stone-900">{value}</dd>
    </div>
  );
}

function renderApiKeyListItem(
  apiKey: ReturnType<typeof createSettingsApiKeysSectionViewModel>["apiKeys"][number],
  isRevoking: boolean,
  onRevoke: (apiKeyId: string, apiKeyName: string) => Promise<void>,
): ReactElement {
  const statusClassName =
    apiKey.statusLabel === "Active"
      ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border border-rose-200 bg-rose-50 text-rose-700";
  const revokeButtonLabel = apiKey.isRevoked
    ? SETTINGS_API_KEYS_REVOKED_ACTION_LABEL
    : isRevoking
      ? SETTINGS_API_KEYS_REVOKE_ACTION_PENDING_LABEL
      : SETTINGS_API_KEYS_REVOKE_ACTION_LABEL;

  return (
    <li
      key={apiKey.id}
      className="h-full min-w-0 rounded-3xl border border-stone-200 bg-[#fcfaf6] p-5"
    >
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0 space-y-1">
          <h3 className="break-words text-base font-semibold text-stone-950">
            {apiKey.name}
          </h3>
          <p className="break-all text-xs uppercase tracking-[0.28em] text-stone-500">
            {apiKey.keyPrefix}
          </p>
        </div>
        <span
          className={`inline-flex max-w-full self-start whitespace-normal break-words rounded-full px-3 py-1 text-left text-xs font-semibold uppercase tracking-[0.24em] ${statusClassName}`}
        >
          {apiKey.statusLabel}
        </span>
      </div>
      <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <p className="min-w-0 break-words text-sm text-stone-600">
          {apiKey.deviceSummary}
        </p>
        <button
          type="button"
          className={revokeApiKeyButtonClassName}
          onClick={() => {
            void onRevoke(apiKey.id, apiKey.name);
          }}
          disabled={apiKey.isRevoked || isRevoking}
          aria-label={`${revokeButtonLabel}: ${apiKey.name}`}
        >
          <StableControlLabel
            label={revokeButtonLabel}
            widestLabel={SETTINGS_API_KEYS_REVOKE_ACTION_PENDING_LABEL}
          />
        </button>
      </div>
      <p className="mt-4 break-words text-sm leading-6 text-stone-600">
        {apiKey.description ?? SETTINGS_API_KEYS_MISSING_DESCRIPTION}
      </p>
      <dl className={metadataListClassName}>
        {[
          renderMetadataItem("Created", apiKey.createdLabel, "created"),
          renderMetadataItem("Last used", apiKey.lastUsedLabel, "last-used"),
          renderMetadataItem("Revoked", apiKey.revokedLabel, "revoked"),
        ]}
      </dl>
    </li>
  );
}

function createApiKeysSectionShell(content: ReactElement[]): ReactElement {
  return (
    <section className={settingsCardClassName}>
      <div className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h2 className="text-lg font-medium text-stone-950">
            {SETTINGS_API_KEYS_SECTION_TITLE}
          </h2>
          <p className="max-w-3xl break-words text-sm leading-6 text-stone-600">
            {SETTINGS_API_KEYS_SECTION_DESCRIPTION}
          </p>
        </div>
      </div>
      <div className="mt-6 space-y-6">{content}</div>
    </section>
  );
}

function renderApiKeysList(
  viewModel: ReturnType<typeof createSettingsApiKeysSectionViewModel>,
  revokingApiKeyId: string | null,
  onRevoke: (apiKeyId: string, apiKeyName: string) => Promise<void>,
): ReactElement {
  if (viewModel.isEmpty) {
    return (
      <div className="rounded-3xl border border-dashed border-stone-300 bg-[#fcfaf6] px-5 py-6 text-sm leading-6 text-stone-600">
        <p className="font-medium text-stone-950">{viewModel.emptyTitle}</p>
        <p className="mt-2">{viewModel.emptyMessage}</p>
      </div>
    );
  }

  return (
    <ul className={apiKeysListClassName}>
      {viewModel.apiKeys.map((apiKey) =>
        renderApiKeyListItem(apiKey, revokingApiKeyId === apiKey.id, onRevoke),
      )}
    </ul>
  );
}

export function SettingsApiKeysClientSection({
  initialData,
}: SettingsApiKeysClientSectionProps): ReactElement {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [data, setData] = useState(initialData);
  const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(null);
  const [revokeErrorMessage, setRevokeErrorMessage] = useState<string | null>(null);
  const [isCreatingApiKey, setIsCreatingApiKey] = useState(false);
  const [revokingApiKeyId, setRevokingApiKeyId] = useState<string | null>(null);
  const form = createSettingsApiKeysCreateFormViewModel();
  const viewModel = createSettingsApiKeysSectionViewModel(data);
  const createApiKeyFieldHintId = `${form.nameField.id}-hint`;
  const createApiKeyFieldErrorId = `${form.nameField.id}-error`;
  const createApiKeyFieldDescribedBy =
    createErrorMessage === null
      ? createApiKeyFieldHintId
      : `${createApiKeyFieldHintId} ${createApiKeyFieldErrorId}`;

  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  async function handleCreateApiKeyFormAction(formData: FormData): Promise<void> {
    setIsCreatingApiKey(true);
    setCreateErrorMessage(null);

    try {
      const result = await submitSettingsApiKeyCreateForm(formData);

      setData((currentData) => upsertSettingsApiKey(currentData, result.apiKey));
      formRef.current?.reset();
      router.refresh();
    } catch (error) {
      setCreateErrorMessage(
        error instanceof Error ? error.message : "API key creation failed.",
      );
    } finally {
      setIsCreatingApiKey(false);
    }
  }

  function confirmApiKeyRevocation(apiKeyName: string): boolean {
    return window.confirm(createSettingsApiKeyRevokeConfirmationMessage(apiKeyName));
  }

  async function handleRevokeApiKey(apiKeyId: string, apiKeyName: string): Promise<void> {
    if (!confirmApiKeyRevocation(apiKeyName)) {
      return;
    }

    setRevokingApiKeyId(apiKeyId);
    setRevokeErrorMessage(null);

    try {
      const result = await submitSettingsApiKeyRevoke(apiKeyId);

      setData((currentData) => upsertSettingsApiKey(currentData, result.apiKey));
      router.refresh();
    } catch (error) {
      setRevokeErrorMessage(
        error instanceof Error ? error.message : "API key revocation failed.",
      );
    } finally {
      setRevokingApiKeyId(null);
    }
  }

  return createApiKeysSectionShell([
    <div key="create-form">
      <form
        ref={formRef}
        action={handleCreateApiKeyFormAction}
        className={`${createApiKeyFormClassName} min-w-0`}
      >
        <div className="min-w-0 space-y-2">
          <h3 className="text-base font-semibold text-stone-950">{form.title}</h3>
          <p className="break-words text-sm leading-6 text-stone-600">
            {form.description}
          </p>
        </div>
        <div className={createApiKeyFieldClassName}>
          <div className={createApiKeyFieldSupportingTextClassName}>
            <label
              htmlFor={form.nameField.id}
              className={createApiKeyFieldLabelClassName}
            >
              {form.nameField.label}
            </label>
            <p id={createApiKeyFieldHintId} className={createApiKeyFieldHintClassName}>
              {form.hint}
            </p>
          </div>
          <input
            id={form.nameField.id}
            name={form.nameField.name}
            type={form.nameField.type}
            required={form.nameField.required}
            minLength={form.nameField.minLength}
            autoComplete={form.nameField.autoComplete}
            placeholder={form.nameField.placeholder}
            className={createApiKeyInputClassName}
            disabled={isCreatingApiKey}
            aria-describedby={createApiKeyFieldDescribedBy}
            aria-invalid={createErrorMessage === null ? undefined : true}
          />
          {createErrorMessage === null ? null : (
            <p id={createApiKeyFieldErrorId} className={createApiKeyFieldErrorClassName}>
              {createErrorMessage}
            </p>
          )}
        </div>
        <div className="mt-4 flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <button
            type="submit"
            className={createApiKeySubmitButtonClassName}
            disabled={isCreatingApiKey}
          >
            <StableControlLabel
              label={
                isCreatingApiKey
                  ? SETTINGS_API_KEYS_CREATE_FORM_SUBMIT_PENDING_LABEL
                  : form.submitLabel
              }
              widestLabel={SETTINGS_API_KEYS_CREATE_FORM_SUBMIT_PENDING_LABEL}
            />
          </button>
        </div>
      </form>
    </div>,
    <div key="body">
      {renderApiKeysList(viewModel, revokingApiKeyId, handleRevokeApiKey)}
      {revokeErrorMessage === null ? null : (
        <p className="mt-4 text-sm text-rose-700">{revokeErrorMessage}</p>
      )}
    </div>,
  ]);
}
