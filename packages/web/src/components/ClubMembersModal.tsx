import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { formatShortDate } from '../lib/time';
import { useClubsStore } from '../stores/clubs';
import { useAuthStore } from '../stores/auth';
import { useModalStore } from '../stores/modal';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
import { StarIcon, SparkIcon, XIcon } from './icons';
import './ClubMembersModal.css';

const ADMIN_BIT = 1n << 10n;

function isAdmin(member: any): boolean {
  return member.roles?.some((r: any) => (BigInt(r.permissions) & ADMIN_BIT) !== 0n) ?? false;
}

export function ClubMembersModal() {
  const close = useModalStore((s) => s.close);
  const clubId = useModalStore((s) => s.modalClubId);
  const clubs = useClubsStore((s) => s.clubs);
  const user = useAuthStore((s) => s.user);
  const club = clubs.find((c) => c.id === clubId);

  const [tab, setTab] = useState<'members' | 'bans'>('members');
  const [members, setMembers] = useState<any[]>([]);
  const [bans, setBans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ type: string; target: any } | null>(null);

  const isOwner = club?.owner_id === user?.id;
  const currentMember = members.find((m) => m.user.id === user?.id);
  const iAmAdmin = isOwner || isAdmin(currentMember || {});

  const loadMembers = useCallback(async () => {
    if (!clubId) return;
    try {
      const data = await api.getMembers(clubId);
      setMembers(data);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, [clubId]);

  const loadBans = useCallback(async () => {
    if (!clubId) return;
    try {
      const data = await api.getBans(clubId);
      setBans(data);
    } catch {}
  }, [clubId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (tab === 'bans') loadBans();
  }, [tab, loadBans]);

  if (!clubId || !club) return null;

  const owner = members.find((m) => m.user.id === club.owner_id);
  const admins = members.filter((m) => m.user.id !== club.owner_id && isAdmin(m));
  const regulars = members.filter((m) => m.user.id !== club.owner_id && !isAdmin(m));

  const handlePromote = async (member: any) => {
    try {
      const roles = await api.getRoles(clubId);
      const adminRole = roles.find((r: any) => (BigInt(r.permissions) & ADMIN_BIT) !== 0n);
      if (!adminRole) { setError('no admin role found'); return; }
      await api.assignRole(clubId, member.user.id, adminRole.id);
      await loadMembers();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDemote = async (member: any) => {
    try {
      const adminRole = member.roles?.find((r: any) => (BigInt(r.permissions) & ADMIN_BIT) !== 0n);
      if (!adminRole) return;
      await api.removeRole(clubId, member.user.id, adminRole.id);
      await loadMembers();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleKick = async (member: any) => {
    try {
      await api.kickMember(clubId, member.user.id);
      await loadMembers();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleBan = async (member: any) => {
    try {
      await api.banMember(clubId, member.user.id);
      await loadMembers();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleUnban = async (ban: any) => {
    try {
      await api.unbanMember(clubId, ban.user_id);
      await loadBans();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleTransfer = async (member: any) => {
    try {
      await api.transferOwnership(clubId, member.user.id);
      await useClubsStore.getState().fetchClubs();
      await loadMembers();
      setConfirmAction(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const renderMemberRow = (member: any, group: 'owner' | 'admin' | 'member') => {
    const isMe = member.user.id === user?.id;
    const canAct = !isMe && ((isOwner && group !== 'owner') || (iAmAdmin && group === 'member'));

    return (
      <div key={member.id} className="member-row">
        <div className="avatar">
          {member.user.avatar_url ? (
            <img src={member.user.avatar_url} alt="" />
          ) : (
            <span>{member.user.name?.[0]?.toUpperCase()}</span>
          )}
        </div>
        <div className="member-info">
          <span className="member-name">
            {member.nickname || member.user.name}
            {group === 'owner' && <StarIcon size={13} className="role-badge role-badge-owner" />}
            {group === 'admin' && <SparkIcon size={13} className="role-badge role-badge-admin" />}
          </span>
          <div className="member-joined">{formatShortDate(member.joined_at)}</div>
        </div>
        {canAct && (
          <div className="member-actions">
            {isOwner && group === 'member' && (
              <button className="btn btn-sm btn-secondary" onClick={() => handlePromote(member)}>promote</button>
            )}
            {isOwner && group === 'admin' && (
              <button className="btn btn-sm btn-secondary" onClick={() => handleDemote(member)}>demote</button>
            )}
            {(isOwner || (iAmAdmin && group === 'member')) && (
              <button className="btn btn-sm btn-secondary" onClick={() => handleKick(member)}>kick</button>
            )}
            {(isOwner || (iAmAdmin && group === 'member')) && (
              <button className="btn btn-sm btn-danger" onClick={() => handleBan(member)}>ban</button>
            )}
            {isOwner && (
              <button className="btn btn-sm btn-secondary" onClick={() => setConfirmAction({ type: 'transfer', target: member })}>transfer</button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal onClose={close} label="members" className="club-members-modal">
      <button className="modal-close" onClick={close} aria-label="close">
        <XIcon size={18} />
      </button>
      <h3 className="title">members</h3>
        {iAmAdmin && (
          <div className="tabs" role="tablist">
            <button className="tab" role="tab" aria-selected={tab === 'members'} onClick={() => setTab('members')}>members</button>
            <button className="tab" role="tab" aria-selected={tab === 'bans'} onClick={() => setTab('bans')}>bans</button>
          </div>
        )}

        {error && <p className="modal-error">{error}</p>}

        {tab === 'members' && (
          <div className="member-list">
            {loading && <div className="empty-state">loading...</div>}
            {!loading && (
              <>
                {owner && (
                  <>
                    <div className="group-label overline">owner</div>
                    {renderMemberRow(owner, 'owner')}
                  </>
                )}
                {admins.length > 0 && (
                  <>
                    <div className="group-label overline">admins ({admins.length})</div>
                    {admins.map((m) => renderMemberRow(m, 'admin'))}
                  </>
                )}
                {regulars.length > 0 && (
                  <>
                    <div className="group-label overline">members ({regulars.length})</div>
                    {regulars.map((m) => renderMemberRow(m, 'member'))}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'bans' && (
          <div className="member-list">
            {bans.length === 0 && <div className="empty-state">no bans</div>}
            {bans.map((ban: any) => (
              <div key={ban.id} className="ban-row">
                <div className="ban-info">
                  <div className="ban-name">{ban.name}</div>
                  {ban.reason && <div className="ban-reason">{ban.reason}</div>}
                </div>
                <button className="btn btn-sm btn-secondary" onClick={() => handleUnban(ban)}>unban</button>
              </div>
            ))}
          </div>
        )}

        {confirmAction?.type === 'transfer' && (
          <ConfirmDialog
            title="transfer ownership"
            message={`transfer ownership of ${club.name} to ${confirmAction.target.user.name}? this cannot be undone.`}
            confirmLabel="transfer"
            danger
            onConfirm={() => handleTransfer(confirmAction.target)}
            onCancel={() => setConfirmAction(null)}
          />
        )}
    </Modal>
  );
}
