import { useId } from "react";
import styles from "./Dialog.module.css";

type Props = {
  title: string;
  children: React.ReactNode;
  /** The dialog's buttons, right-aligned under the body. */
  actions: React.ReactNode;
  /** `alertdialog` for a question the user must answer before going on. */
  role: "dialog" | "alertdialog";
};

/** A modal panel over a scrim, in the instrument-panel look (square, hairline border). */
export function Dialog({ title, children, actions, role }: Props) {
  const titleId = useId();
  return (
    <div className={styles.scrim}>
      <section className={styles.panel} role={role} aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <div className={styles.body}>{children}</div>
        <div className={styles.actions}>{actions}</div>
      </section>
    </div>
  );
}

export { styles as dialogStyles };
