/** Escudo y nombre de la institución, para encabezar todas las pantallas. */
export function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <div className="brand">
      <img src="/logo.png" alt="Escuela de Dirigentes" className="brand__logo" />
      <div>
        <p className="brand__name">
          Escuela de
          <br />
          Dirigentes
        </p>
        {subtitle && <p className="brand__sub">{subtitle}</p>}
      </div>
    </div>
  );
}
