import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface DonateModalProps {
  open: boolean
  onClose: () => void
  /** Buy Me a Coffee 用户名（不含 @，用于构造 https://buymeacoffee.com/<name>） */
  bmcUsername?: string
  /** 支付宝收款码图片路径（相对站点根） */
  alipayQrSrc?: string
  /** 支付宝页内提示文案 */
  alipayHint?: string
  /** 是否显示 Buy Me a Coffee 渠道。默认 false —— 配置好 BMC 账号后再开启。 */
  showBmc?: boolean
}

const DEFAULT_BMC = 'your-name'
const DEFAULT_ALIPAY_HINT = '打开支付宝，扫一扫上方二维码'

export function DonateModal({
  open,
  onClose,
  bmcUsername = DEFAULT_BMC,
  alipayQrSrc = '/alipay.jpg',
  alipayHint = DEFAULT_ALIPAY_HINT,
  showBmc = false,
}: DonateModalProps) {
  const [imgError, setImgError] = useState(false)

  const close = useCallback(() => {
    setImgError(false)
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, close])

  if (!open) return null
  if (typeof document === 'undefined') return null

  const bmcHref = `https://buymeacoffee.com/${encodeURIComponent(bmcUsername)}`

  return createPortal(
    <div
      className="donate-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="donate-title"
      onClick={close}
    >
      <div
        className="donate-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="donate-head">
          <div className="min-w-0">
            <h2 id="donate-title" className="donate-title">
              支持项目
            </h2>
            <p className="donate-sub">
              如果这个工具帮助你做出更好的投资决策，欢迎请我喝杯咖啡 ☕
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="donate-close"
            aria-label="关闭"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="donate-body">
          <section className="donate-card">
            <div className="donate-card-head">
              <span className="donate-card-title">支付宝</span>
            </div>
            <div className="donate-qr-wrap">
              {imgError ? (
                <div className="donate-qr-fallback">
                  二维码加载失败，请检查 <code>public/alipay.jpg</code> 是否存在
                </div>
              ) : (
                <img
                  src={alipayQrSrc}
                  alt="支付宝收款二维码"
                  className="donate-qr"
                  onError={() => setImgError(true)}
                  loading="lazy"
                  decoding="async"
                />
              )}
            </div>
            <div className="donate-hint donate-hint-spacer">{alipayHint}</div>
          </section>

          {showBmc && (
            <section className="donate-card">
              <div className="donate-card-head">
                <span className="donate-card-title">Buy Me a Coffee</span>
              </div>
              <div className="donate-bmc-hero">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
                  <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
                  <line x1="6" y1="1" x2="6" y2="4" />
                  <line x1="10" y1="1" x2="10" y2="4" />
                  <line x1="14" y1="1" x2="14" y2="4" />
                  <path d="M6 12h8" />
                </svg>
              </div>
              <p className="donate-desc">
                面向国际用户的快速小额支持渠道，支持信用卡 / PayPal，即点即付，单笔无需手续费。
              </p>
              <ul className="donate-bullets">
                <li>无需注册账号</li>
                <li>支持留言</li>
              </ul>
              <a
                href={bmcHref}
                target="_blank"
                rel="noopener noreferrer"
                className="donate-cta"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ color: '#111111' }}
                >
                  <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
                  <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
                  <line x1="6" y1="1" x2="6" y2="4" />
                  <line x1="10" y1="1" x2="10" y2="4" />
                  <line x1="14" y1="1" x2="14" y2="4" />
                  <path d="M6 13c1.5 0 1.5 1 3 1s1.5-1 3-1 1.5 1 3 1" />
                </svg>
                <span>Buy me a coffee</span>
                <svg
                  className="donate-cta-arrow"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M7 17L17 7" />
                  <path d="M7 7h10v10" />
                </svg>
              </a>
            </section>
          )}
        </div>

        <p className="donate-foot">
          资金将用于数据 API 调用、服务器与个人维护时间。
        </p>
      </div>

      <style>{`
        .donate-overlay {
          position: fixed;
          inset: 0;
          z-index: 10000;
          background-color: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 24px 16px;
          overflow-y: auto;
          animation: donate-fade var(--dur-2) var(--ease);
        }
        .donate-panel {
          width: 100%;
          max-width: 640px;
          align-self: center;
          background-color: rgb(var(--c-surface));
          border: 1px solid rgb(var(--c-border));
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
          animation: donate-pop var(--dur-3) var(--ease);
        }
        .donate-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding-bottom: 14px;
          border-bottom: 1px solid rgb(var(--c-border));
        }
        .donate-title {
          font-size: 16px;
          font-weight: 600;
          color: rgb(var(--c-text));
          letter-spacing: 0.02em;
        }
        .donate-sub {
          margin-top: 4px;
          font-size: 12px;
          color: rgb(var(--c-text-2));
        }
        .donate-close {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border: 1px solid rgb(var(--c-border));
          border-radius: 5px;
          background: transparent;
          color: rgb(var(--c-text-3));
          cursor: pointer;
          transition:
            background-color var(--dur-1) var(--ease),
            color var(--dur-1) var(--ease);
        }
        .donate-close:hover {
          background-color: rgb(var(--c-surface-2));
          color: rgb(var(--c-text));
        }
        .donate-body {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
          margin-top: 16px;
        }
        @media (min-width: 560px) {
          .donate-body {
            grid-template-columns: 1fr 1fr;
          }
        }
        .donate-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 16px;
          background-color: rgb(var(--c-surface-2));
          border: 1px solid rgb(var(--c-border));
          border-radius: 6px;
        }        .donate-card-head {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        .donate-badge {
          font-family: var(--font-mono);
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          padding: 2px 6px;
          border-radius: 3px;
          background-color: rgb(var(--c-accent) / 0.12);
          color: rgb(var(--c-accent));
        }
        .donate-badge--global {
          background-color: rgb(var(--c-up) / 0.12);
          color: rgb(var(--c-up));
        }
        .donate-card-title {
          font-size: 13px;
          font-weight: 600;
          color: rgb(var(--c-text));
        }
        .donate-qr-wrap {
          width: 180px;
          height: 180px;
          padding: 8px;
          background-color: #fff;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .donate-qr {
          width: 100%;
          height: 100%;
          object-fit: contain;
          image-rendering: pixelated;
        }
        .donate-qr-fallback {
          font-size: 11px;
          color: rgb(var(--c-text-3));
          padding: 8px;
          text-align: center;
          line-height: 1.5;
        }
        .donate-qr-fallback code {
          font-family: var(--font-mono);
          font-size: 10px;
          padding: 1px 4px;
          background-color: rgb(var(--c-surface-3));
          border-radius: 3px;
        }
        .donate-hint {
          margin-top: 10px;
          font-size: 11px;
          color: rgb(var(--c-text-3));
        }
        .donate-hint-spacer {
          margin-top: auto;
        }
        .donate-desc {
          font-size: 11px;
          color: rgb(var(--c-text-2));
          line-height: 1.6;
          margin-bottom: 10px;
        }
        .donate-bmc-hero {
          width: 64px;
          height: 64px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background-color: #ffdd00;
          color: #111111;
          margin: 4px 0 12px;
          box-shadow: 0 4px 12px rgba(255, 221, 0, 0.2);
        }
        .donate-bullets {
          list-style: none;
          padding: 0;
          margin: 0 0 14px;
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 6px;
        }
        .donate-bullets li {
          font-family: var(--font-mono);
          font-size: 10px;
          color: rgb(var(--c-text-2));
          padding: 2px 8px;
          border-radius: 3px;
          background-color: rgb(var(--c-surface-3));
          border: 1px solid rgb(var(--c-border));
        }
        .donate-cta {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-top: auto;
          padding: 9px 16px;
          background-color: #ffdd00;
          color: #111111;
          font-size: 12px;
          font-weight: 700;
          border-radius: 5px;
          text-decoration: none;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.08);
          transition:
            background-color var(--dur-1) var(--ease),
            transform var(--dur-1) var(--ease),
            box-shadow var(--dur-1) var(--ease);
        }
        .donate-cta:hover {
          background-color: #ffe533;
          transform: translateY(-1px);
          box-shadow: 0 4px 10px rgba(255, 221, 0, 0.25);
        }
        .donate-cta-arrow {
          margin-left: 2px;
          opacity: 0.85;
        }
        .donate-foot {
          margin-top: 16px;
          padding-top: 12px;
          border-top: 1px solid rgb(var(--c-border));
          font-size: 10px;
          font-family: var(--font-mono);
          letter-spacing: 0.02em;
          color: rgb(var(--c-text-3));
          text-align: center;
        }
        @keyframes donate-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes donate-pop {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>,
    document.body,
  )
}

interface DonateButtonProps {
  bmcUsername?: string
  alipayQrSrc?: string
  alipayHint?: string
  /** 是否启用 Buy Me a Coffee 渠道。默认 false。 */
  showBmc?: boolean
}

/**
 * Topbar 用的小爱心按钮，点击打开捐赠弹窗。
 * 彩色渐变爱心 + 循环脉冲动画 + 悬停加速。
 */
export function DonateButton(props: DonateButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="donate-btn"
        title="支持项目"
        aria-label="支持项目"
      >
        <svg
          className="donate-btn-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="url(#donateGrad)"
          stroke="url(#donateGrad)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="donateGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ff6b9a" />
              <stop offset="55%" stopColor="#ff8a5b" />
              <stop offset="100%" stopColor="#ffb84d" />
            </linearGradient>
          </defs>
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
        <span className="donate-btn-pulse" aria-hidden="true" />
      </button>
      <DonateModal
        open={open}
        onClose={() => setOpen(false)}
        bmcUsername={props.bmcUsername}
        alipayQrSrc={props.alipayQrSrc}
        alipayHint={props.alipayHint}
        showBmc={props.showBmc}
      />
      <style>{`
        .donate-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          flex-shrink: 0;
          border-radius: 6px;
          border: 1px solid rgb(var(--c-border));
          // background-color: rgb(var(--c-surface));
          cursor: pointer;
          overflow: visible;
          transition:
            border-color var(--dur-1) var(--ease),
            background-color var(--dur-1) var(--ease),
            transform var(--dur-1) var(--ease);
        }
        .donate-btn:hover {
          border-color: rgb(var(--c-border-strong, var(--c-line-strong)));
          background-color: rgb(var(--c-surface-2));
          transform: translateY(-1px);
        }
        .donate-btn-icon {
          position: relative;
          z-index: 2;
          animation: donate-icon-pulse 2.4s var(--ease) infinite;
          transform-origin: center;
          filter: drop-shadow(0 1px 2px rgba(255, 107, 154, 0.35));
        }
        .donate-btn:hover .donate-btn-icon {
          animation-duration: 1.2s;
        }
        .donate-btn-pulse {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          z-index: 1;
        }
        .donate-btn-pulse::before,
        .donate-btn-pulse::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: radial-gradient(
            circle at center,
            rgba(255, 107, 154, 0.28) 0%,
            rgba(255, 184, 77, 0.16) 45%,
            rgba(255, 107, 154, 0) 75%
          );
          opacity: 0;
          animation: donate-ring 2.4s var(--ease) infinite;
        }
        .donate-btn-pulse::after {
          animation-delay: 1.2s;
        }
        .donate-btn:hover .donate-btn-pulse::before,
        .donate-btn:hover .donate-btn-pulse::after {
          animation-duration: 1.2s;
        }
        @keyframes donate-icon-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.18); }
        }
        @keyframes donate-ring {
          0% { opacity: 0.55; transform: scale(0.6); }
          70% { opacity: 0; transform: scale(1.4); }
          100% { opacity: 0; transform: scale(1.4); }
        }
        @media (prefers-reduced-motion: reduce) {
          .donate-btn-icon,
          .donate-btn-pulse::before,
          .donate-btn-pulse::after {
            animation: none;
          }
        }
      `}</style>
    </>
  )
}
