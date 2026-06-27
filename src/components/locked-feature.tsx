import { Lock } from "lucide-react";

export function LockedFeature({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-8">
      <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
        <Lock size={20} className="text-gray-400" />
      </div>
      <h2 className="text-base font-semibold text-gray-800 mb-1">{name} is not available</h2>
      <p className="text-sm text-gray-400 max-w-xs leading-relaxed">
        This feature hasn&apos;t been enabled for your account yet. Reach out to get access.
      </p>
    </div>
  );
}
