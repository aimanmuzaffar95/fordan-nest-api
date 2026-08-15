/**
 * Solar position geometry (Duffie & Beckman, "Solar Engineering of Thermal
 * Processes", standard equations). Pure math, no I/O.
 *
 * Modelling choice: **monthly representative-day, hourly-synthesis** method.
 * For each of the 12 Klein representative days we integrate irradiance over
 * every daylight solar-hour-angle bin (15 deg = 1 hour) rather than using a
 * single monthly-average clear-sky number. This is necessary because the
 * transposition model (HDKR) and the inverter clipping model are both
 * strongly nonlinear in instantaneous irradiance/power — averaging first and
 * transposing/clipping second gives materially wrong answers (e.g. clipping
 * never triggers on a flattened "average" day). Hourly synthesis on 12 days
 * is 12 * ~10-14 daylight steps per array, i.e. a few hundred iterations per
 * design — comfortably under the 100ms budget while capturing the shape PVWatts
 * itself computes from (its own engine is sub-hourly TMY data).
 *
 * We deliberately do NOT convert hour-angle to local clock time (no equation
 * of time / longitude correction applied to the integration loop): the loop
 * only needs the hour-angle domain to be symmetric about solar noon, which it
 * is by construction. `equationOfTimeMinutes` is still implemented below,
 * exported for any future clock-time display (e.g. "sunrise 6:42am") — it is
 * intentionally unused by the energy integration itself.
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const toRad = (deg: number): number => deg * DEG_TO_RAD;
const toDeg = (rad: number): number => rad * RAD_TO_DEG;

/** Day-angle B (degrees), Duffie & Beckman eq. 1.4.2. */
export const dayAngleDeg = (dayOfYear: number): number =>
  ((dayOfYear - 1) * 360) / 365;

/** Cooper's equation for solar declination, degrees. */
export const declinationDeg = (dayOfYear: number): number =>
  23.45 * Math.sin(toRad((360 * (284 + dayOfYear)) / 365));

/**
 * Equation of time, minutes (Spencer's Fourier approximation). Exported for
 * completeness / future clock-time display; not used by the energy loop.
 */
export const equationOfTimeMinutes = (dayOfYear: number): number => {
  const b = toRad(dayAngleDeg(dayOfYear));
  return (
    229.2 *
    (0.000075 +
      0.001868 * Math.cos(b) -
      0.032077 * Math.sin(b) -
      0.014615 * Math.cos(2 * b) -
      0.04089 * Math.sin(2 * b))
  );
};

/** Sunset hour angle, degrees (positive), for a given latitude/declination. */
export const sunsetHourAngleDeg = (
  latitudeDeg: number,
  declDeg: number,
): number => {
  const cosOmegaS = -Math.tan(toRad(latitudeDeg)) * Math.tan(toRad(declDeg));
  const clipped = Math.max(-1, Math.min(1, cosOmegaS));
  return toDeg(Math.acos(clipped));
};

/** cos(solar zenith) for latitude/declination/hour-angle (all degrees). */
export const cosZenith = (
  latitudeDeg: number,
  declDeg: number,
  hourAngleDeg: number,
): number => {
  const phi = toRad(latitudeDeg);
  const delta = toRad(declDeg);
  const omega = toRad(hourAngleDeg);
  return (
    Math.sin(phi) * Math.sin(delta) +
    Math.cos(phi) * Math.cos(delta) * Math.cos(omega)
  );
};

/**
 * cos(angle of incidence) on a tilted, oriented surface. `surfaceAzimuthDeg`
 * uses the south=0, east-negative/west-positive convention (Duffie &
 * Beckman gamma) — callers pass `compassAzimuth - 180`.
 */
export const cosIncidence = (
  latitudeDeg: number,
  declDeg: number,
  hourAngleDeg: number,
  tiltDeg: number,
  surfaceAzimuthDeg: number,
): number => {
  const phi = toRad(latitudeDeg);
  const delta = toRad(declDeg);
  const omega = toRad(hourAngleDeg);
  const beta = toRad(tiltDeg);
  const gamma = toRad(surfaceAzimuthDeg);

  return (
    Math.sin(delta) * Math.sin(phi) * Math.cos(beta) -
    Math.sin(delta) * Math.cos(phi) * Math.sin(beta) * Math.cos(gamma) +
    Math.cos(delta) * Math.cos(phi) * Math.cos(beta) * Math.cos(omega) +
    Math.cos(delta) *
      Math.sin(phi) *
      Math.sin(beta) *
      Math.cos(gamma) *
      Math.cos(omega) +
    Math.cos(delta) * Math.sin(beta) * Math.sin(gamma) * Math.sin(omega)
  );
};

/** Compass azimuth (0=N,90=E,180=S,270=W) -> Duffie/Beckman south=0 convention. */
export const compassToSouthZeroAzimuth = (
  compassAzimuthDeg: number,
): number => {
  let deg = compassAzimuthDeg - 180;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
};

export type HourAngleGrid = { hourAngleDeg: number }[];

/** Build the daylight hour-angle sample grid for a given sunset hour angle. */
export const buildDaylightHourAngles = (
  sunsetAngleDeg: number,
  stepDeg: number,
): number[] => {
  const angles: number[] = [];
  for (let omega = -sunsetAngleDeg; omega <= sunsetAngleDeg; omega += stepDeg) {
    angles.push(omega);
  }
  return angles;
};
