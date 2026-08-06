import type { OptionTally } from '../api.js';

interface Props {
  tally: OptionTally[];
  /** La opción que eligió quien mira, para marcarla. */
  mine?: string | null;
  /** Variante para el proyector: números y barras más grandes. */
  grande?: boolean;
}

/**
 * Reparto de una consigna de opción múltiple.
 *
 * Las barras se miden contra la opción más votada y no contra el total: con
 * cuatro opciones repartidas parejo, medir contra el total deja todas las
 * barras por debajo de un tercio y no se distingue nada de lejos, que es
 * justamente donde esto se mira.
 */
export function Tally({ tally, mine, grande }: Props) {
  if (tally.length === 0) return null;
  const total = tally.reduce((suma, item) => suma + item.count, 0);
  const maximo = Math.max(1, ...tally.map((item) => item.count));

  return (
    <ul className={`tally${grande ? ' tally--grande' : ''}`}>
      {tally.map((item) => {
        const porcentaje = total === 0 ? 0 : Math.round((item.count / total) * 100);
        return (
          <li
            key={item.option}
            className={`tally__fila${item.option === mine ? ' tally__fila--mia' : ''}`}
          >
            <div className="tally__encabezado">
              <span className="tally__opcion">{item.option}</span>
              <span className="tally__numero">
                {item.count}
                {total > 0 && <span className="tally__porcentaje"> · {porcentaje}%</span>}
              </span>
            </div>
            <div className="tally__pista">
              <div
                className="tally__barra"
                style={{ width: `${(item.count / maximo) * 100}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
