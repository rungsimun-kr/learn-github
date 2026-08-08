import { PALETTE, type AnnotationStyle, type Tool } from '../lib/annotations';

interface AnnotationToolbarProps {
  tool: Tool;
  style: AnnotationStyle;
  canDelete: boolean;
  onTool: (tool: Tool) => void;
  onStyle: (patch: Partial<AnnotationStyle>) => void;
  onDelete: () => void;
}

const TOOLS: Array<{ id: Tool; icon: string; label: string }> = [
  { id: 'select', icon: '⬈', label: 'Select and move' },
  { id: 'text', icon: 'T', label: 'Text box' },
  { id: 'rect', icon: '▭', label: 'Rectangle' },
  { id: 'ellipse', icon: '◯', label: 'Ellipse' },
  { id: 'line', icon: '╱', label: 'Line' },
  { id: 'arrow', icon: '↗', label: 'Arrow' },
  { id: 'ink', icon: '✎', label: 'Freehand' },
];

export default function AnnotationToolbar({
  tool,
  style,
  canDelete,
  onTool,
  onStyle,
  onDelete,
}: AnnotationToolbarProps) {
  const isShape = tool === 'rect' || tool === 'ellipse';
  const isStroke = tool === 'line' || tool === 'arrow' || tool === 'ink';

  return (
    <div className="annotation-toolbar">
      <div className="tool-row" role="radiogroup" aria-label="Drawing tool">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="radio"
            aria-checked={tool === entry.id}
            aria-label={entry.label}
            title={entry.label}
            className={`tool-button${tool === entry.id ? ' is-active' : ''}`}
            onClick={() => onTool(entry.id)}
          >
            {entry.icon}
          </button>
        ))}
      </div>

      <div className="style-row">
        <div className="swatches" role="radiogroup" aria-label="Colour">
          {PALETTE.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="radio"
              aria-checked={style.color === entry.value}
              aria-label={entry.label}
              title={entry.label}
              className={`swatch${style.color === entry.value ? ' is-active' : ''}`}
              style={{ background: entry.value }}
              onClick={() => onStyle({ color: entry.value })}
            />
          ))}
        </div>

        {isShape ? (
          <>
            <label className="inline-field">
              <input
                type="checkbox"
                checked={style.filled}
                onChange={(event) => onStyle({ filled: event.target.checked })}
              />
              <span>Fill</span>
            </label>
            {style.filled ? (
              <label className="inline-field" title="Below 100% the fill highlights; at 100% it covers">
                <span>Opacity</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={style.opacity}
                  onChange={(event) => onStyle({ opacity: Number(event.target.value) })}
                />
                <span className="hint">{Math.round(style.opacity * 100)}%</span>
              </label>
            ) : null}
          </>
        ) : null}

        {isShape || isStroke ? (
          <label className="inline-field">
            <span>Width</span>
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={style.thickness}
              onChange={(event) => onStyle({ thickness: Number(event.target.value) })}
            />
            <span className="hint">{style.thickness}</span>
          </label>
        ) : null}

        {tool === 'arrow' ? (
          <label className="inline-field">
            <input
              type="checkbox"
              checked={style.arrowStart}
              onChange={(event) => onStyle({ arrowStart: event.target.checked })}
            />
            <span>Head at both ends</span>
          </label>
        ) : null}

        {tool === 'text' ? (
          <label className="inline-field">
            <span>Size</span>
            <input
              type="range"
              min={8}
              max={48}
              step={1}
              value={style.fontSize}
              onChange={(event) => onStyle({ fontSize: Number(event.target.value) })}
            />
            <span className="hint">{style.fontSize}</span>
          </label>
        ) : null}

        <button
          type="button"
          className="button danger"
          disabled={!canDelete}
          onClick={onDelete}
          title="Delete the selected mark"
        >
          Delete mark
        </button>
      </div>
    </div>
  );
}
