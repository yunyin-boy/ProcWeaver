// ==========================================================================
// ProcWeaver src-next 落地 IP 与出口网络体检模型
// ==========================================================================

export interface ExitIpHealthInfo {
  ip: string;
  country: string;
  city?: string;
  asn: string;
  fraudScore: number; // 0 ~ 100 欺诈风控分
  isResidential: boolean; // 是否家宽
  firstPacketMs?: number;
  testedAt?: number;
}
