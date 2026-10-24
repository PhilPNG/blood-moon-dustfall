import { useLanguage } from '../i18n';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
export function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="modal" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label={t("Close dialog")} onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
