import { Button, Dialog, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { currentPasswordAsk, type PasswordAsk, subscribePasswordAsks } from "../lib/ssh";

/** The password an ssh host asks for, kept by the backend until the app closes; see `reachSsh`. */
export function SshPassword() {
  const { t } = useTranslation();
  const ask = useSyncExternalStore(subscribePasswordAsks, currentPasswordAsk, currentPasswordAsk);
  const [password, setPassword] = useState("");
  // Kept for the fade-out after the ask is answered.
  const last = useRef<PasswordAsk | null>(null);
  if (ask) last.current = ask;
  const shown = ask ?? last.current;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new ask starts blank
  useEffect(() => setPassword(""), [ask]);

  if (!shown) return null;

  const submit = () => ask?.answer(password);

  return (
    <Dialog
      open={ask !== null}
      onClose={() => ask?.answer(null)}
      slotProps={{ paper: { sx: { width: 360 } } }}
    >
      <Stack
        component="form"
        sx={{ p: 2, gap: 1.5 }}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Typography variant="subtitle2" noWrap>
          {t("ssh.passwordTitle", { host: shown.host })}
        </Typography>
        <TextField
          autoFocus
          fullWidth
          size="small"
          type="password"
          autoComplete="off"
          value={password}
          error={shown.wrong}
          label={t("ssh.password")}
          helperText={shown.wrong ? t("ssh.wrongPassword") : t("ssh.passwordKept")}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Stack direction="row" sx={{ gap: 1, justifyContent: "flex-end" }}>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            onClick={() => ask?.answer(null)}
            sx={{ color: "text.secondary" }}
          >
            {t("ssh.cancel")}
          </Button>
          <Button size="small" variant="outlined" type="submit">
            {t("ssh.connect")}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
