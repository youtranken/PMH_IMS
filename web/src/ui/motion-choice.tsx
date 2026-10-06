import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MOTION_EVENT, motionPreference, setMotionPreference, type MotionPreference } from '@/lib/motion';
import { SegmentedRadio } from '@/ui/segmented-radio';

/**
 * "Hiệu ứng chuyển động": Theo hệ thống / Luôn bật / Tắt (Q-21) — đặt cạnh lựa chọn Giao diện
 * trong Hồ sơ của tôi. Lựa chọn nằm ở trình duyệt (lib/motion.ts), như theme.
 */
export function MotionChoice() {
  const { t } = useTranslation();
  const [pref, setPref] = useState<MotionPreference>(() => motionPreference());
  useEffect(() => {
    const sync = () => setPref(motionPreference());
    window.addEventListener(MOTION_EVENT, sync);
    return () => window.removeEventListener(MOTION_EVENT, sync);
  }, []);
  return (
    <SegmentedRadio<MotionPreference>
      label={t('profile.motionTitle')}
      value={pref}
      onChange={setMotionPreference}
      options={[
        { value: 'system', label: t('profile.motionSystem') },
        { value: 'on', label: t('profile.motionOn') },
        { value: 'off', label: t('profile.motionOff') },
      ]}
    />
  );
}
