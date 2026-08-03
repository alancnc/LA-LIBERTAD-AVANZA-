import type { ClusterStatus, RankedCluster } from '../api.js';

const STATUS_LABEL: Record<ClusterStatus, string> = {
  pending: 'pendiente',
  answering: 'respondiendo',
  answered: 'respondida',
  discarded: 'descartada',
};

export interface AdminActions {
  onStatusChange: (clusterId: string, status: ClusterStatus) => void;
  onRename: (cluster: RankedCluster) => void;
  onNote: (cluster: RankedCluster) => void;
  onMerge: (cluster: RankedCluster) => void;
  onSplitQuestion: (questionId: string) => void;
  onHideQuestion: (questionId: string) => void;
  /** Grupo elegido como origen de una fusión pendiente. */
  mergeSource: string | null;
}

interface Props {
  cluster: RankedCluster;
  position: number;
  expanded: boolean;
  onToggle: () => void;
  onVote?: (questionId: string) => void;
  votingDisabled?: boolean;
  admin?: AdminActions;
}

export function ClusterCard({
  cluster,
  position,
  expanded,
  onToggle,
  onVote,
  votingDisabled,
  admin,
}: Props) {
  const isTop = position === 1 && cluster.status !== 'answered' && cluster.status !== 'discarded';
  const isMergeSource = admin?.mergeSource === cluster.id;

  return (
    <article
      className={`cluster cluster--${cluster.status}${isTop ? ' cluster--top' : ''}`}
      style={isMergeSource ? { outline: '2px dashed var(--primary)' } : undefined}
    >
      <div className="cluster__rank">
        <div className="cluster__score">{cluster.score}</div>
        <div className="cluster__score-label">
          {cluster.score === 1 ? 'persona' : 'personas'}
        </div>
      </div>

      <div className="cluster__body">
        <h3 className="cluster__label">
          #{position} · {cluster.label}
        </h3>

        <div className="cluster__meta">
          <span className={`badge badge--${cluster.status}`}>{STATUS_LABEL[cluster.status]}</span>
          {cluster.questionCount > 1 && (
            <span className="badge badge--hot">
              {cluster.questionCount} preguntas parecidas
            </span>
          )}
          <span>
            {cluster.questionCount} {cluster.questionCount === 1 ? 'pregunta' : 'preguntas'} ·{' '}
            {cluster.upvotes} {cluster.upvotes === 1 ? 'voto' : 'votos'}
          </span>
          <button type="button" className="btn btn--ghost btn--small" onClick={onToggle}>
            {expanded ? 'Ocultar preguntas' : 'Ver preguntas'}
          </button>
        </div>

        {cluster.note && <p className="cluster__note">{cluster.note}</p>}

        {expanded && (
          <ul className="questions">
            {cluster.questions.map((question) => (
              <li className="question" key={question.id}>
                {onVote && (
                  <button
                    type="button"
                    className={`vote${question.votedByMe ? ' vote--voted' : ''}`}
                    onClick={() => onVote(question.id)}
                    disabled={votingDisabled || question.mine}
                    title={
                      question.mine
                        ? 'Es tu pregunta'
                        : question.votedByMe
                          ? 'Quitar mi voto'
                          : 'También quiero que respondan esto'
                    }
                  >
                    <span className="vote__arrow">▲</span>
                    <span className="vote__count">{question.upvotes}</span>
                  </button>
                )}
                <div className="question__text">
                  <div>{question.text}</div>
                  <div className="question__author">
                    {question.author}
                    {question.mine && ' · vos'}
                    {!onVote && ` · ${question.upvotes} votos`}
                  </div>
                  {admin && (
                    <div className="row" style={{ marginTop: '0.35rem' }}>
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        onClick={() => admin.onSplitQuestion(question.id)}
                        disabled={cluster.questionCount <= 1}
                        title="Sacarla de este grupo y darle tema propio"
                      >
                        Separar
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--small btn--danger"
                        onClick={() => admin.onHideQuestion(question.id)}
                      >
                        Ocultar
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {admin && (
          <div className="cluster__actions">
            {cluster.status !== 'answering' && (
              <button
                type="button"
                className="btn btn--small"
                onClick={() => admin.onStatusChange(cluster.id, 'answering')}
              >
                Respondiendo ahora
              </button>
            )}
            {cluster.status !== 'answered' && (
              <button
                type="button"
                className="btn btn--small btn--primary"
                onClick={() => admin.onStatusChange(cluster.id, 'answered')}
              >
                Marcar respondida
              </button>
            )}
            {cluster.status !== 'pending' && (
              <button
                type="button"
                className="btn btn--small"
                onClick={() => admin.onStatusChange(cluster.id, 'pending')}
              >
                Volver a pendiente
              </button>
            )}
            <button
              type="button"
              className="btn btn--small"
              onClick={() => admin.onRename(cluster)}
            >
              Renombrar
            </button>
            <button type="button" className="btn btn--small" onClick={() => admin.onNote(cluster)}>
              Nota
            </button>
            <button type="button" className="btn btn--small" onClick={() => admin.onMerge(cluster)}>
              {isMergeSource ? 'Cancelar fusión' : admin.mergeSource ? 'Fusionar acá' : 'Fusionar'}
            </button>
            {cluster.status !== 'discarded' && (
              <button
                type="button"
                className="btn btn--small btn--danger"
                onClick={() => admin.onStatusChange(cluster.id, 'discarded')}
              >
                Descartar
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
