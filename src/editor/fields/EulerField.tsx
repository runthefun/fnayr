import type { NumberSchema } from "../../engine/schema";
import { DraggableNumber } from "./DraggableNumber";

type Quat = [number, number, number, number];
type Euler = [number, number, number];

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/** Quaternion → Euler angles in degrees (intrinsic XYZ order). */
function quatToEulerDeg(q: Quat): Euler {
  const [x, y, z, w] = q;

  // Roll (X)
  const sinr_cosp = 2 * (w * x + y * z);
  const cosr_cosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr_cosp, cosr_cosp);

  // Pitch (Y) — clamp for gimbal lock
  const sinp = 2 * (w * y - z * x);
  const pitch =
    Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 : Math.asin(sinp);

  // Yaw (Z)
  const siny_cosp = 2 * (w * z + x * y);
  const cosy_cosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny_cosp, cosy_cosp);

  return [roll * DEG, pitch * DEG, yaw * DEG];
}

/** Euler angles in degrees → quaternion (intrinsic XYZ order). */
function eulerDegToQuat(euler: Euler): Quat {
  const halfX = (euler[0] * RAD) / 2;
  const halfY = (euler[1] * RAD) / 2;
  const halfZ = (euler[2] * RAD) / 2;

  const cx = Math.cos(halfX);
  const sx = Math.sin(halfX);
  const cy = Math.cos(halfY);
  const sy = Math.sin(halfY);
  const cz = Math.cos(halfZ);
  const sz = Math.sin(halfZ);

  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

const LABELS = ["X", "Y", "Z"];

/** Schema for each Euler axis — finite degrees, no min/max. */
const degreeSchema: NumberSchema = { type: "number", finite: true };

type Props = {
  value: Quat;
  onChange: (v: Quat) => void;
};

export function EulerField({ value, onChange }: Props) {
  const euler = quatToEulerDeg(value);

  return (
    <div className="flex gap-1">
      {LABELS.map((label, i) => (
        <DraggableNumber
          key={label}
          label={label}
          value={euler[i]}
          schema={degreeSchema}
          speed={0.5}
          onChange={(v) => {
            const next: Euler = [...euler];
            next[i] = v;
            onChange(eulerDegToQuat(next));
          }}
        />
      ))}
    </div>
  );
}
