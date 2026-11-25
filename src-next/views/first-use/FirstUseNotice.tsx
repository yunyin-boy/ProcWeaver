import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { FileText } from "lucide-react";
import license from "../../../LICENSE?raw";
import { Button } from "../../primitives/Button";
import { isTauriEnvironment } from "../../services/client";
import {
  confirmFirstUse, exitFirstUse, getFirstUseStatus,
  type FirstUseStatus, type GuideProgress,
} from "../../services/firstUseService";

export function FirstUseNoticeContent() {
  return (
    <div className="workbench-first-use-copy">
      <section>
        <h3>软件与服务范围</h3>
        <p>ProcWeaver 是基于 Mihomo 的开源网络客户端，在本机管理代理配置、转发流量和执行进程分流。代理服务器、节点、订阅和网络接入服务由你自行取得。业务规则包用于匹配应用和配置分流，启用前需要绑定出口。</p>
      </section>
      <section>
        <h3>无担保与责任限制</h3>
        <p>在适用法律允许的范围内，除另有书面说明外，软件按现状提供。版权人及其他提供者不作明示或默示的担保，包括对软件适销性和特定用途适用性的担保。</p>
        <p>除适用法律另有要求或另有书面约定外，版权人及依许可修改或分发软件的各方，对因使用或无法使用软件所致的损害不承担赔偿责任，包括数据丢失、网络中断或与其他程序不兼容所致的损失。具体范围见随附许可证第 15 至 17 条。</p>
      </section>
      <section>
        <h3>使用责任与第三方服务</h3>
        <p>请遵守适用的法律法规和服务条款，在获授权的设备和网络上使用。你应核对导入的订阅、节点、配置及规则集的来源和授权，并对自己的配置和操作负责。</p>
        <p>第三方的收费分发、捆绑销售和代配置由经营方独立开展，收费、服务和售后由提供方负责。项目方对第三方内容和服务的安全性、准确性与可用性不作担保。</p>
      </section>
      <section>
        <h3>开启后会发生什么</h3>
        <p>系统代理、TUN、DNS 和进程分流会按配置改变本机或指定应用的连接方式。需要恢复连接时，可在「核心概览」关闭系统代理和 TUN，在「进程分流」暂停接管，并在「系统首选项」调整 DNS。</p>
      </section>
      <section>
        <h3>哪些信息留在本机，什么时候会联网</h3>
        <p>便携版在程序目录的 <code>data</code> 文件夹保存配置。更新订阅会访问订阅地址，测速会访问所选测试端点。核心概览的出口体检会通过 IPpure、IP.SB 或 ip-api 查询出口 IP 和网络位置。</p>
      </section>
      <section>
        <h3>开源许可</h3>
        <p>ProcWeaver 采用 AGPL-3.0-only。软件的运行、修改、分发及免责声明的适用范围以许可证原文为准。</p>
        <details>
          <summary>查看开源许可证原文</summary>
          <pre>{license}</pre>
        </details>
      </section>
    </div>
  );
}

export function FirstUseGate({ children }: { children: (guide: GuideProgress, available: boolean) => ReactNode }) {
  const [status, setStatus] = useState<FirstUseStatus | null>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const isDesktop = isTauriEnvironment();

  useEffect(() => {
    if (!isDesktop) return;
    let active = true;
    getFirstUseStatus().then((next) => {
      if (next !== null && !next?.confirmationPhrase) throw new Error("须知状态不可用");
      if (active) setStatus(next);
    }).catch(() => {
      if (active) setError("读取首次使用设置失败，请重试。");
    });
    return () => { active = false; };
  }, [attempt, isDesktop]);

  if (!isDesktop || status === null) return children({ dismissed: true, method: null }, false);
  if (status?.confirmed) return children(status.guide, true);

  const matches = !!status && phrase.trim() === status.confirmationPhrase;
  const accept = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!status || !matches || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      setStatus(await confirmFirstUse(status.noticeVersion, phrase.trim()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const exit = async () => {
    if (inFlight.current) return;
    try {
      await exitFirstUse();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <div className="workbench-window workbench-first-use">
      <form className="workbench-first-use-dialog workbench-dialog" onSubmit={accept}
        role="dialog" aria-modal="true" aria-labelledby="first-use-title">
        <header className="workbench-first-use-header">
          <span className="workbench-first-use-icon"><FileText size={21} aria-hidden="true" /></span>
          <div>
            <h1 id="first-use-title">首次使用须知</h1>
            <p>请阅读使用说明与免责声明。</p>
          </div>
        </header>
        <div className="workbench-first-use-scroll" tabIndex={0} aria-label="须知正文">
          <FirstUseNoticeContent />
        </div>
        <div className="workbench-first-use-footer">
          {status && (
            <div className="workbench-first-use-confirm">
              <p id="first-use-phrase-hint">
                请输入 <strong data-native-context-menu>{status.confirmationPhrase}</strong>
              </p>
              <input id="first-use-phrase" value={phrase} disabled={busy} autoComplete="off"
                aria-label="输入确认语" aria-describedby="first-use-phrase-hint"
                data-native-context-menu={busy ? undefined : ""}
                spellCheck={false} onChange={(event) => setPhrase(event.target.value)}
                placeholder="输入或粘贴确认语" />
            </div>
          )}
          {!status && !error && <p role="status">正在读取首次使用设置…</p>}
          {error && <p role="alert" className="text-[var(--workbench-danger)]">{error}</p>}
          <div className="workbench-first-use-actions">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void exit()}>退出软件</Button>
            {status ? (
              <Button type="submit" variant="primary" disabled={!matches || busy} loading={busy}>确认并继续</Button>
            ) : error && (
              <Button type="button" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>重试</Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
