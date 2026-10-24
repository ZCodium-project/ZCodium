import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type {
  ConnectionProfile,
  SourceServerRecord,
  ISourceServerManagementService,
} from "./contract.js";
import { DEFAULT_REMOTE_ASSET_INSTALL_MODE } from "./contract.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useRemoteConnectionForm } from "@/hooks/useRemoteConnectionForm.js";
import { RemoteConnectionFields } from "@/RemoteConnectionFields.js";
import { RemoteConnectionKindTag } from "@/remote-connection/RemoteConnectionTags.js";
import {
  buildProfileEditTarget,
  validateProfileEdit,
  getSourceServerManagementErrorMessage,
} from "./sourceServerSettingsActions.js";

interface Props {
  profile: ConnectionProfile | null;
  source?: SourceServerRecord;
  management: ISourceServerManagementService;
  onClose: () => void;
  onSaved: () => void;
  focusField?: "host" | "auth";
}

export function EditConnectionProfileDialog(props: Props) {
  return props.profile ? (
    <EditConnectionProfileForm key={props.profile.profileId} {...props} profile={props.profile} />
  ) : null;
}

/** 沿用官方编辑交互，字段复用本仓 #68 版本，不能覆盖回旧 CDN 安装表单。 */
function EditConnectionProfileForm({
  profile,
  source,
  management,
  onClose,
  onSaved,
  focusField,
}: Props & { profile: ConnectionProfile }) {
  const { intl } = useZCodeIntl();
  const form = useRemoteConnectionForm({
    open: true,
    isWindowsDesktop: profile.transport === "wsl",
    preferredKind: profile.transport,
  });
  const [name, setName] = useState(profile.displayName ?? profile.transport);
  const [deviceName, setDeviceName] = useState(source?.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [originalAliasCleared, setOriginalAliasCleared] = useState(false);
  const initialize = useEffectEvent(() => {
    const target = profile.target;
    if (target.kind === "ssh") {
      form.setHost(target.host);
      form.setPort(String(target.port ?? 22));
      form.setUsername(target.username);
      form.setSshAuthMethod(target.privateKeyPath ? "privateKey" : "password");
      form.setPrivateKeyPath(target.privateKeyPath ?? "");
      form.setAssetInstallMode(target.assetInstallMode ?? DEFAULT_REMOTE_ASSET_INSTALL_MODE);
      if (target.sshConfigAlias)
        form.applySshConfigAlias({
          alias: target.sshConfigAlias,
          host: target.host,
          port: target.port ?? 22,
          username: target.username,
          privateKeyPath: target.privateKeyPath,
        });
    } else if (target.kind === "wsl") {
      form.setWslDistro(target.distro ?? "");
      form.setWslUser(target.user ?? "");
    } else form.setManualDockerContainer(target.container);
    const selector =
      focusField === "auth"
        ? 'input[type="password"]'
        : focusField === "host"
          ? 'input[data-testid="ssh-host-input"]'
          : null;
    if (selector) formRef.current?.querySelector<HTMLInputElement>(selector)?.focus();
  });
  useEffect(() => {
    initialize();
  }, [profile.profileId]);
  const save = async () => {
    if (savingRef.current) return;
    const invalid = !name.trim()
      ? "settings.source.connectionNameRequired"
      : source && !deviceName.trim()
        ? "settings.source.deviceNameRequired"
        : validateProfileEdit(profile.target, form);
    if (invalid) {
      setError(intl.formatMessage({ id: invalid }));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await management.updateProfile({
        profileId: profile.profileId,
        profileDisplayName: name.trim(),
        ...(source && deviceName.trim() !== source.displayName
          ? { sourceDisplayName: deviceName.trim() }
          : {}),
        ...(profile.target.kind === "ssh" ? { sshAuthMethod: form.sshAuthMethod } : {}),
        target: buildProfileEditTarget(profile.target, { ...form, originalAliasCleared }),
      });
      onSaved();
      onClose();
    } catch (cause) {
      setError(getSourceServerManagementErrorMessage(cause, intl.formatMessage));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !savingRef.current) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>
                {intl.formatMessage({ id: "settings.source.editConnectionTitle" })}
              </DialogTitle>
              <RemoteConnectionKindTag kind={profile.transport} />
            </div>
            <DialogDescription>
              {intl.formatMessage({ id: "settings.source.editConnectionDescription" })}
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={saving} className="min-w-0 space-y-4">
            <label className="block space-y-1.5 text-ui-sm">
              <span>{intl.formatMessage({ id: "settings.source.connectionName" })}</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            {source ? (
              <label className="block space-y-1.5 text-ui-sm">
                <span>{intl.formatMessage({ id: "settings.source.deviceName" })}</span>
                <Input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
              </label>
            ) : null}
            <RemoteConnectionFields
              {...form}
              clearSelectedSshConfigAlias={() => {
                setOriginalAliasCleared(true);
                form.clearSelectedSshConfigAlias();
              }}
              applySshConfigAlias={(option) => {
                setOriginalAliasCleared(false);
                form.applySshConfigAlias(option);
              }}
              kind={profile.transport}
              runtimeOptionsLoading={form.currentRuntimeOptionsLoading}
            />
            {profile.target.kind === "ssh" &&
            (profile.target.passwordCredentialKey ||
              profile.target.privateKeyPassphraseCredentialKey) ? (
              <p className="text-ui-sm text-remote-foreground-muted">
                {intl.formatMessage({ id: "settings.source.keepSavedSecret" })}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-ui-sm text-destructive">
                {error}
              </p>
            ) : null}
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button type="submit" disabled={saving} aria-busy={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {intl.formatMessage({ id: saving ? "common.saving" : "common.saveChanges" })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
