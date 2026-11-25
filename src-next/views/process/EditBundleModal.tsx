// ==========================================================================
// ProcWeaver src-next 兼容重定向: EditBundleModal -> ProcessBundleModal
// ==========================================================================

import React from "react";
import { ProcessBundleItem } from "../../types/processRouting";
import { ProcessBundleModal, BundleFormData } from "./ProcessBundleModal";

interface EditBundleModalProps {
  isOpen: boolean;
  bundle: ProcessBundleItem | null;
  availableProxies: string[];
  onClose: () => void;
  onSave: (bundleId: string, updates: Partial<ProcessBundleItem>) => Promise<void>;
}

export const EditBundleModal: React.FC<EditBundleModalProps> = ({
  isOpen,
  bundle,
  availableProxies,
  onClose,
  onSave,
}) => {
  const handleSave = async (data: BundleFormData) => {
    if (!bundle) return;
    await onSave(bundle.id, {
      name: data.name,
      description: data.description,
      targetProxy: data.targetProxy,
      mainExe: data.mainExe,
      exes: data.exes,
      policy: data.policy,
    });
  };

  return (
    <ProcessBundleModal
      isOpen={isOpen}
      mode="edit"
      bundle={bundle}
      availableProxies={availableProxies}
      onClose={onClose}
      onSave={handleSave}
    />
  );
};
