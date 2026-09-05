import Form from "@rjsf/core";
import type { RJSFSchema } from "@rjsf/utils";
import { customizeValidator } from "@rjsf/validator-ajv8";
import {
  Component,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { FilePreviewNodeData } from "../../../lib/graph";
import { totexSchema } from "../../../lib/totexSchema";

export type SchemaHandle = { save: () => Promise<boolean> };
type Attachment = { name: string; schema: RJSFSchema };
const attachments = new Map<string, Attachment>();
const storageKey = (path: string) => `totex.schema:${path}`;
function attached(path: string): Attachment | null {
  const cached = attachments.get(path);
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(storageKey(path));
    if (stored) return JSON.parse(stored);
  } catch {
    /* In-memory attachments still work when storage is unavailable. */
  }
  return /(^|[/\\])totex\.json$/i.test(path)
    ? { name: "totex.json schema", schema: totexSchema }
    : null;
}

class FormBoundary extends Component<
  { children: ReactNode; message: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p role="alert">{this.props.message}</p> : this.props.children;
  }
}

export function SchemaReading({
  data,
  ref,
  write,
}: {
  data: FilePreviewNodeData;
  ref: Ref<SchemaHandle>;
  write: (requestId: number, text: string, expected?: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [attachment, setAttachment] = useState(() => attached(data.path));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const form = useRef<Form>(null);
  const pending = useRef<Promise<boolean> | null>(null);
  const source = useRef(data.text);
  const parse = useMemo(() => {
    try {
      return { value: JSON.parse(data.text ?? ""), valid: !data.truncated };
    } catch {
      return { value: undefined, valid: false };
    }
  }, [data.text, data.truncated]);
  const [value, setValue] = useState(parse.value);
  useEffect(() => {
    if (!dirty) {
      setValue(parse.value);
      source.current = data.text;
    }
  }, [parse.value, data.text, dirty]);
  const validator = useMemo(() => customizeValidator({}), []);
  const schemaError = useMemo(() => {
    if (!attachment) return "";
    try {
      if (
        !attachment.schema ||
        typeof attachment.schema !== "object" ||
        Array.isArray(attachment.schema)
      )
        throw new Error("Expected a JSON Schema object");
      const result = validator.rawValidation(attachment.schema, undefined);
      return result.validationError?.message ?? "";
    } catch (reason) {
      return String(reason);
    }
  }, [attachment, validator]);

  async function save(): Promise<boolean> {
    if (pending.current) return pending.current;
    if (!dirty) return true;
    if (source.current !== data.text) {
      setError(t("filePreview.schemaConflict"));
      return false;
    }
    if (!parse.valid || schemaError || !form.current?.validateForm()) return false;
    const text = `${JSON.stringify(value, null, 2)}\n`;
    setBusy(true);
    pending.current = write(data.requestId, text, source.current ?? undefined);
    try {
      const saved = await pending.current;
      if (saved) {
        source.current = text;
        setDirty(false);
        setError("");
      } else setError(t("filePreview.schemaSaveFailed"));
      return saved;
    } finally {
      pending.current = null;
      setBusy(false);
    }
  }
  useImperativeHandle(ref, () => ({ save }));

  return (
    <div className="schema-reading nodrag nowheel">
      <div className="schema-reading__attachment">
        <label>
          {t("filePreview.attachSchema")}
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file || !(await save())) return;
              try {
                const schema = JSON.parse(await file.text());
                if (!schema || typeof schema !== "object" || Array.isArray(schema))
                  throw new Error(t("filePreview.schemaInvalid"));
                const check = customizeValidator({}).rawValidation(schema, undefined);
                if (check.validationError) throw check.validationError;
                const next = { name: file.name, schema };
                attachments.set(data.path, next);
                setAttachment(next);
                setError("");
                try {
                  localStorage.setItem(storageKey(data.path), JSON.stringify(next));
                } catch {
                  setError(t("filePreview.schemaStorageFailed"));
                }
              } catch (reason) {
                setError(`${t("filePreview.schemaInvalid")}: ${String(reason)}`);
              }
            }}
          />
        </label>
        {attachment && <span>{attachment.name}</span>}
      </div>
      {dirty && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setValue(parse.value);
            source.current = data.text;
            setDirty(false);
            setError("");
          }}
        >
          {t("filePreview.schemaDiscard")}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {!attachment && <p>{t("filePreview.schemaEmpty")}</p>}
      {schemaError && (
        <p role="alert">
          {t("filePreview.schemaInvalid")}: {schemaError}
        </p>
      )}
      {!parse.valid && <p role="alert">{t("filePreview.schemaJsonInvalid")}</p>}
      {attachment && !schemaError && parse.valid && (
        <FormBoundary key={JSON.stringify(attachment)} message={t("filePreview.schemaInvalid")}>
          <Form
            ref={form}
            schema={attachment.schema}
            validator={validator}
            formData={value}
            idPrefix={`schema-${data.requestId}`}
            disabled={busy}
            noHtml5Validate
            experimental_defaultFormStateBehavior={{
              emptyObjectFields: "skipDefaults",
              arrayMinItems: { populate: "never" },
            }}
            onChange={(event) => {
              setValue(event.formData);
              setDirty(true);
            }}
            onSubmit={() => void save()}
          >
            <button type="submit" disabled={busy || !dirty}>
              {t(busy ? "filePreview.schemaSaving" : "filePreview.schemaSave")}
              {dirty ? " *" : ""}
            </button>
          </Form>
        </FormBoundary>
      )}
    </div>
  );
}
