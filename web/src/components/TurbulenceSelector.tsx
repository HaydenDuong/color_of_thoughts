import './TurbulenceSelector.css'

/**
 * Five-level turbulence rating for the "how turbulent is your day?" question.
 *
 * Visual order (left → right) is calm → turbulent, mapping onto Aaron Iker's
 * animated face radios (https://codepen.io/aaroniker/pen/RwKZeeR, MIT):
 *   1 = happy  = "Calm"
 *   2 = good   = "Settled"
 *   3 = ok     = "Mixed"         ← default
 *   4 = sad    = "Restless"
 *   5 = angry  = "Turbulent"
 *
 * The container is a cream pill (Uiverse.io reaction-bar look) with per-option
 * tooltips on hover; the face inside each pill is drawn with inline SVG strokes
 * + CSS pseudo-elements and animates on selection (shake / tear / flash).
 */

export type TurbulenceRating = 1 | 2 | 3 | 4 | 5

type Face = 'happy' | 'good' | 'ok' | 'sad' | 'angry'

type Option = {
  value: TurbulenceRating
  face: Face
  label: string
}

const OPTIONS: readonly Option[] = [
  { value: 1, face: 'happy', label: 'Calm' },
  { value: 2, face: 'good', label: 'Settled' },
  { value: 3, face: 'ok', label: 'Mixed' },
  { value: 4, face: 'sad', label: 'Restless' },
  { value: 5, face: 'angry', label: 'Turbulent' },
] as const

const EYE_PATH =
  'M1,1 C1.83333333,2.16666667 2.66666667,2.75 3.5,2.75 C4.33333333,2.75 5.16666667,2.16666667 6,1'
const MOUTH_PATH =
  'M1,5.5 C3.66666667,2.5 6.33333333,1 9,1 C11.6666667,1 14.3333333,2.5 17,5.5'

type Props = {
  value: TurbulenceRating
  onChange: (v: TurbulenceRating) => void
  /** Unique name for the radio group (lets multiple selectors coexist if ever needed). */
  name?: string
  disabled?: boolean
}

export function TurbulenceSelector({
  value,
  onChange,
  name = 'turbulence',
  disabled = false,
}: Props) {
  return (
    <div
      className="turbulence-selector"
      role="radiogroup"
      aria-label="How turbulent is your day?"
    >
      {OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className={`ts-option ts-${opt.face}`}
          data-tooltip={opt.label}
          aria-label={`${opt.label} (${opt.value} of 5)`}
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            disabled={disabled}
            onChange={() => onChange(opt.value)}
          />
          <div className="ts-face">
            {/* `ok` is a flat mouth + two dot-eyes drawn entirely via CSS
                pseudo-elements, so it has no inline SVG. */}
            {opt.face !== 'ok' && (
              <>
                <svg className="ts-eye ts-eye-left" viewBox="0 0 7 4">
                  <path d={EYE_PATH} />
                </svg>
                <svg className="ts-eye ts-eye-right" viewBox="0 0 7 4">
                  <path d={EYE_PATH} />
                </svg>
                {/* `happy`'s smile is drawn via `::after` so the curl fills
                    instead of stroking; every other face has a real mouth. */}
                {opt.face !== 'happy' && (
                  <svg className="ts-mouth" viewBox="0 0 18 7">
                    <path d={MOUTH_PATH} />
                  </svg>
                )}
              </>
            )}
          </div>
        </label>
      ))}
    </div>
  )
}
