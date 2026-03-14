// ═══════════════════════════════════════════════════════════
// controllers/communityController.js — Nakama  (v6 fixed)
// ═══════════════════════════════════════════════════════════

const Community        = require("../models/Community");
const User             = require("../models/User");
const Message          = require("../models/Message");
const EphemeralMessage = require("../models/EphemeralmessageComunnity");
const mongoose         = require("mongoose");

function getIO(req) { return req.app.get("io"); }

// ── util: emite join_event al room de la comunidad ────────
async function emitJoinEvent(io, communityId, joinedUsers, memberCount) {
  const payload = JSON.stringify({ users: joinedUsers, memberCount });
  io.to(`community:${communityId}`).emit("message:new", {
    id: `join_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    isSystem: true,
    text: `JOIN_EVENT:${payload}`,
    createdAt: new Date().toISOString(),
  });
}

async function notifyInvitedUsers(io, communityId, communityName, userIds) {
  for (const uid of userIds) {
    io.to(`user:${uid}`).emit("community:added", {
      communityId,
      communityName,
      message: `Fuiste añadido a la comunidad "${communityName}"`,
    });
  }
}

function getMemberId(m) {
  return String(m.userId ?? m._id ?? "");
}

// ════════════════════════════════════════════════════════════
// GET /comunidades
// ════════════════════════════════════════════════════════════
exports.getCommunities = async (req, res) => {
  try {
    const userId      = req.user._id ?? req.user.id;
    const createdByMe = req.query.createdByMe === "true";
    const query       = createdByMe
      ? { creatorId: new mongoose.Types.ObjectId(String(userId)) }
      : {};

    const communities = await Community.find(query).sort({ createdAt: -1 }).lean();

    const result = communities.map((c) => {
      const member = c.members?.find(
        (m) => String(m.userId ?? m._id ?? "") === String(userId),
      );
      const isMember    = !!member;
      const unreadCount = isMember ? (c.unreadCounts?.[String(userId)] ?? 0) : 0;

      return {
        _id:           c._id,
        name:          c.name,
        description:   c.description,
        avatarUrl:     c.avatarUrl,
        coverUrl:      c.coverUrl,
        memberCount:   c.memberCount ?? c.members?.length ?? 0,
        likeCount:     c.likeCount ?? 0,
        isLiked:       (c.likes ?? []).some((id) => String(id) === String(userId)),
        isMember,
        messagingOpen: c.messagingOpen ?? true,
        theme:         c.theme ?? "dark",
        creatorId:     String(c.creatorId ?? ""),
        createdAt:     c.createdAt,
        unreadCount,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("getCommunities:", err);
    res.status(500).json({ message: "Error interno" });
  }
};

// ════════════════════════════════════════════════════════════
// POST /comunidades
// ════════════════════════════════════════════════════════════
exports.createCommunity = async (req, res) => {
  try {
    const { name, description, avatarUrl, coverUrl, members: memberIds = [] } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "El nombre es requerido" });

    const creatorId       = new mongoose.Types.ObjectId(String(req.user.id));
    const creatorUsername = req.user.username;
    const creatorDoc      = await User.findById(creatorId, "avatarUrl profileVideo").lean();

    const validIds = memberIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .filter((id) => String(id) !== String(creatorId));

    const invitedUsers = validIds.length > 0
      ? await User.find({ _id: { $in: validIds } }, "username avatarUrl profileVideo").lean()
      : [];

    const initialMembers = [
      {
        userId:    creatorId,
        username:  creatorUsername,
        avatarUrl: creatorDoc?.avatarUrl ?? null,
        role:      "admin",
        hasStar:   false, frameColor: "none", frozen: false, msgCount: 0, joinedAt: new Date(),
      },
      ...invitedUsers.map((u) => ({
        userId:       new mongoose.Types.ObjectId(String(u._id)),
        username:     u.username,
        avatarUrl:    u.avatarUrl ?? null,
        profileVideo: u.profileVideo ?? null,
        role:         "member",
        hasStar:      false, frameColor: "none", frozen: false, msgCount: 0, joinedAt: new Date(),
      })),
    ];

    const community = await Community.create({
      name:          name.trim(),
      description:   description?.trim() ?? "",
      avatarUrl:     avatarUrl ?? null,
      coverUrl:      coverUrl ?? null,
      creatorId,
      memberCount:   initialMembers.length,
      likeCount:     0,
      messagingOpen: true,
      theme:         "dark",
      members:       initialMembers,
    });

    const io = getIO(req);
    io.to(`user:${creatorId}`).emit("community:added", {
      communityId: community._id, communityName: community.name,
      message: `Creaste la comunidad "${community.name}"`,
    });

    if (invitedUsers.length > 0) {
      await notifyInvitedUsers(io, community._id, community.name, invitedUsers.map((u) => u._id));
      await emitJoinEvent(
        io, community._id,
        invitedUsers.map((u) => ({ _id: u._id, username: u.username, avatarUrl: u.avatarUrl })),
        community.memberCount,
      );
    }

    res.status(201).json(community);
  } catch (err) {
    console.error("createCommunity:", err);
    res.status(500).json({ message: "Error al crear comunidad" });
  }
};

// ════════════════════════════════════════════════════════════
// GET /comunidades/:id
// ════════════════════════════════════════════════════════════
exports.getCommunityById = async (req, res) => {
  try {
    const userId    = req.user._id;
    const community = await Community.findById(req.params.id).lean();
    if (!community) return res.status(404).json({ message: "No encontrada" });

    const memberIds = (community.members ?? []).map((m) => m.userId ?? m._id);
    const userDocs  = await User.find(
      { _id: { $in: memberIds } }, "username avatarUrl profileVideo",
    ).lean();
    const userMap = Object.fromEntries(userDocs.map((u) => [String(u._id), u]));

    const enriched = (community.members ?? []).map((m) => {
      const uid  = getMemberId(m);
      const user = userMap[uid] ?? {};
      return {
        _id:          uid,
        username:     m.username ?? user.username ?? "Usuario",
        avatarUrl:    user.avatarUrl    ?? m.avatarUrl    ?? null,
        profileVideo: user.profileVideo ?? m.profileVideo ?? null,
        role:         m.role       ?? "member",
        hasStar:      m.hasStar    ?? false,
        frameColor:   m.frameColor ?? "none",
        frozen:       m.frozen     ?? false,
        frozenUntil:  m.frozenUntil ?? null,
        msgCount:     m.msgCount   ?? 0,
        joinedAt:     m.joinedAt,
      };
    });

    res.json({
      ...community,
      members:     enriched,
      memberCount: enriched.length,
      theme:       community.theme ?? "dark",
      isLiked:     (community.likes ?? []).some((id) => String(id) === String(userId)),
      isMember:    enriched.some((m) => m._id === String(userId)),
    });
  } catch (err) {
    console.error("getCommunityById:", err);
    res.status(500).json({ message: "Error interno" });
  }
};

// ════════════════════════════════════════════════════════════
// POST /comunidades/:id/invite
// ════════════════════════════════════════════════════════════
exports.inviteMembers = async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0)
      return res.status(400).json({ message: "userIds requerido" });

    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: "No encontrada" });

    const callerId      = String(req.user._id ?? req.user.id ?? "");
    const callerMember  = community.members.find((m) => getMemberId(m) === callerId);
    const isCreator     = String(community.creatorId) === callerId;
    const isAdminMember = callerMember?.role === "admin";
    const isGlobalAdmin = ["admin", "superadmin"].includes(String(req.user.role ?? ""));

    if (!isCreator && !isAdminMember && !isGlobalAdmin)
      return res.status(403).json({ message: "Solo admins pueden invitar" });

    const existingIds = new Set(community.members.map((m) => getMemberId(m)));
    const newIds = userIds
      .map((id) => String(id))
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .filter((id) => !existingIds.has(id));

    if (newIds.length === 0) return res.json({ message: "Todos ya son miembros", added: 0 });

    const users = await User.find({ _id: { $in: newIds } }, "username avatarUrl profileVideo").lean();
    if (users.length === 0) return res.status(404).json({ message: "Usuarios no encontrados" });

    community.members.push(...users.map((u) => ({
      userId:       new mongoose.Types.ObjectId(String(u._id)),
      username:     u.username,
      avatarUrl:    u.avatarUrl    ?? null,
      profileVideo: u.profileVideo ?? null,
      role: "member", hasStar: false, frameColor: "none", frozen: false, msgCount: 0, joinedAt: new Date(),
    })));
    community.memberCount = community.members.length;
    await community.save();

    const io = getIO(req);
    await emitJoinEvent(
      io, community._id,
      users.map((u) => ({ _id: u._id, username: u.username, avatarUrl: u.avatarUrl })),
      community.memberCount,
    );
    io.to(`community:${community._id}`).emit("community:member_count", { memberCount: community.memberCount });
    await notifyInvitedUsers(io, community._id, community.name, users.map((u) => String(u._id)));

    res.json({ message: `${users.length} miembro(s) agregado(s)`, added: users.length });
  } catch (err) {
    console.error("inviteMembers:", err);
    res.status(500).json({ message: "Error al invitar" });
  }
};

// ════════════════════════════════════════════════════════════
// POST /comunidades/:id/join
// ════════════════════════════════════════════════════════════
exports.joinCommunity = async (req, res) => {
  try {
    const userId    = req.user._id;
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: "No encontrada" });

    if (community.members.some((m) => getMemberId(m) === String(userId)))
      return res.json({ message: "Ya sos miembro" });

    if ((community.bannedUsers ?? []).some((id) => String(id) === String(userId)))
      return res.status(403).json({ message: "Estás baneado de esta comunidad" });

    const user = await User.findById(userId, "username avatarUrl profileVideo").lean();
    community.members.push({
      userId, username: user.username, avatarUrl: user.avatarUrl ?? null,
      profileVideo: user.profileVideo ?? null,
      role: "member", hasStar: false, frameColor: "none", frozen: false, msgCount: 0, joinedAt: new Date(),
    });
    community.memberCount = community.members.length;
    await community.save();

    const io = getIO(req);
    await emitJoinEvent(
      io, community._id,
      [{ _id: userId, username: user.username, avatarUrl: user.avatarUrl }],
      community.memberCount,
    );
    io.to(`community:${community._id}`).emit("community:member_count", { memberCount: community.memberCount });
    io.to(`user:${userId}`).emit("community:added", {
      communityId: community._id, communityName: community.name,
      message: `Te uniste a "${community.name}"`,
    });

    res.json({ message: "Te uniste correctamente", memberCount: community.memberCount });
  } catch (err) {
    console.error("joinCommunity:", err);
    res.status(500).json({ message: "Error al unirse" });
  }
};

// ════════════════════════════════════════════════════════════
// PATCH /comunidades/:id
// ════════════════════════════════════════════════════════════
exports.updateCommunity = async (req, res) => {
  try {
    const { name, description, avatarUrl, coverUrl } = req.body;
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: "No encontrada" });

    if (name !== undefined)        community.name        = name.trim();
    if (description !== undefined) community.description = description;
    if (avatarUrl !== undefined)   community.avatarUrl   = avatarUrl;
    if (coverUrl !== undefined)    community.coverUrl    = coverUrl;
    await community.save();

    getIO(req).to(`community:${community._id}`).emit("community:settings_update", {
      name:        community.name,
      description: community.description,
      avatarUrl:   community.avatarUrl,
      coverUrl:    community.coverUrl,
    });

    res.json(community);
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
};

// ════════════════════════════════════════════════════════════
// PATCH /comunidades/:id/rules
// ════════════════════════════════════════════════════════════
exports.updateRules = async (req, res) => {
  try {
    const community = await Community.findByIdAndUpdate(
      req.params.id, { rules: req.body.rules ?? "" }, { new: true },
    );
    if (!community) return res.status(404).json({ message: "No encontrada" });
    res.json({ rules: community.rules });
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
};

// ════════════════════════════════════════════════════════════
// PATCH /comunidades/:id/settings
// ════════════════════════════════════════════════════════════
exports.updateSettings = async (req, res) => {
  try {
    const { messagingOpen, theme } = req.body;
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: "No encontrada" });

    if (messagingOpen !== undefined) community.messagingOpen = messagingOpen;

    const VALID_THEMES = ["dark","light","ocean","forest","sakura","neon","gold","galaxy"];
    if (theme !== undefined && VALID_THEMES.includes(theme)) community.theme = theme;

    await community.save();

    getIO(req).to(`community:${community._id}`).emit("community:settings_update", {
      messagingOpen: community.messagingOpen,
      theme:         community.theme,
    });

    res.json({ messagingOpen: community.messagingOpen, theme: community.theme });
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
};

// ════════════════════════════════════════════════════════════
// POST / DELETE /comunidades/:id/like
// ════════════════════════════════════════════════════════════
exports.likeCommunity = async (req, res) => {
  try {
    const uid = req.user._id;
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: "No encontrada" });
    if (!(community.likes ?? []).some((id) => String(id) === String(uid))) {
      community.likes = [...(community.likes ?? []), uid];
      community.likeCount = community.likes.length;
      await community.save();
    }
    res.json({ likeCount: community.likeCount });
  } catch (err) { res.status(500).json({ message: "Error" }); }
};

exports.unlikeCommunity = async (req, res) => {
  try {
    const uid = req.user._id;
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: "No encontrada" });
    community.likes     = (community.likes ?? []).filter((id) => String(id) !== String(uid));
    community.likeCount = community.likes.length;
    await community.save();
    res.json({ likeCount: community.likeCount });
  } catch (err) { res.status(500).json({ message: "Error" }); }
};

// ════════════════════════════════════════════════════════════
// POST /comunidades/:id/report
// ════════════════════════════════════════════════════════════
exports.reportCommunity = async (req, res) => {
  res.json({ message: "Denuncia recibida. Gracias." });
};



// ════════════════════════════════════════════════════════════
// POST /comunidades/:id/leave
// ════════════════════════════════════════════════════════════
exports.leaveCommunity = async (req, res) => {
  try {
    const userId    = String(req.user._id ?? req.user.id ?? "");
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: "No encontrada" });

    // El creador no puede abandonar
    if (String(community.creatorId) === userId)
      return res.status(403).json({ message: "El creador no puede abandonar la comunidad" });

    const before = community.members.length;
    community.members     = community.members.filter((m) => getMemberId(m) !== userId);
    community.memberCount = community.members.length;
    await community.save();

    if (community.members.length < before) {
      const io = getIO(req);
      io.to(`community:${community._id}`).emit("community:member_removed", { memberId: userId });
      io.to(`community:${community._id}`).emit("community:member_count",   { memberCount: community.memberCount });
    }

    res.json({ ok: true, message: "Abandonaste la comunidad" });
  } catch (err) {
    console.error("leaveCommunity:", err);
    res.status(500).json({ message: "Error al salir" });
  }
};

// ════════════════════════════════════════════════════════════
// GET /comunidades/:id/feed
// ════════════════════════════════════════════════════════════
exports.getFeed = async (req, res) => {
  try {
    const callerId = String(req.user._id ?? req.user.id ?? "");
    const limit    = Math.min(parseInt(req.query.limit ?? "80"), 200);

    const community = await Community.findById(req.params.id).lean();
    if (!community) return res.status(404).json({ message: "No encontrada" });

    const memberMap = Object.fromEntries(
      (community.members ?? []).map((m) => [getMemberId(m), m]),
    );

    const msgs = await Message.find({
      roomType: "community",
      roomId:   req.params.id,
    })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    const ephemerals = await EphemeralMessage.find({
      roomType: "community",
      roomId:   req.params.id,
    })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    const allSenderIds = [
      ...new Set([
        ...msgs.map((m) => String(m.sender ?? "")),
        ...ephemerals.map((e) => String(e.senderId ?? "")),
      ].filter(Boolean)),
    ];
    const userDocs = await User.find(
      { _id: { $in: allSenderIds } }, "username avatarUrl profileVideo",
    ).lean();
    const userMap = Object.fromEntries(userDocs.map((u) => [String(u._id), u]));

    const normalFeed = msgs.map((m) => {
      const sid    = String(m.sender ?? "");
      const member = memberMap[sid] ?? {};
      const user   = userMap[sid]   ?? {};
      const isJoin = m.isSystem && m.text?.startsWith("JOIN_EVENT:");

      return {
        _id:          String(m._id),
        type:         isJoin ? "join_event" : "message",
        senderId:     sid,
        senderName:   user.username    ?? member.username  ?? "Usuario",
        senderAvatar: user.avatarUrl   ?? member.avatarUrl ?? null,
        senderVideo:  user.profileVideo?.url ?? member.profileVideo?.url ?? null,
        senderFrame:  member.frameColor ?? "none",
        hasStar:      member.hasStar    ?? false,
        isAdmin:      member.role === "admin",
        text:         isJoin ? undefined : (m.deletedForAll ? "" : m.text),
        deleted:      m.deletedForAll ?? false,
        edited:       m.edited ?? false,
        editedText:   (m.edited && !m.deletedForAll) ? m.text : undefined,
        joinedUsers:  isJoin
          ? (() => { try { return JSON.parse(m.text.replace("JOIN_EVENT:", "")).users; } catch { return []; } })()
          : undefined,
        memberNumber: isJoin
          ? (() => { try { return JSON.parse(m.text.replace("JOIN_EVENT:", "")).memberNumber; } catch { return undefined; } })()
          : undefined,
        createdAt: m.createdAt?.toISOString?.() ?? m.createdAt,
      };
    });

    const ephFeed = ephemerals.map((e) => {
      const sid      = String(e.senderId ?? "");
      const member   = memberMap[sid] ?? {};
      const user     = userMap[sid]   ?? {};
      const viewRecord = (e.recipients ?? []).find((r) => String(r.userId) === callerId);
      const viewedByMe = viewRecord?.viewed ?? false;

      return {
        _id:               String(e._id),
        type:              "ephemeral",
        senderId:          sid,
        senderName:        user.username    ?? member.username  ?? "Usuario",
        senderAvatar:      user.avatarUrl   ?? member.avatarUrl ?? null,
        senderVideo:       user.profileVideo?.url ?? null,
        senderFrame:       member.frameColor ?? "none",
        hasStar:           member.hasStar   ?? false,
        isAdmin:           member.role === "admin",
        thumbnailUrl:      e.thumbnailUrl   ?? null,
        caption:           e.caption        ?? "",
        ephemeralDestroyed: e.destroyed     ?? false,
        ephemeralViewed:   viewedByMe,
        createdAt:         e.createdAt?.toISOString?.() ?? e.createdAt,
      };
    });

    const combined = [...normalFeed, ...ephFeed].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    res.json(combined);
  } catch (err) {
    console.error("getFeed:", err);
    res.status(500).json({ message: "Error al obtener feed" });
  }
};

// ════════════════════════════════════════════════════════════
// POST /comunidades/:id/messages
// ════════════════════════════════════════════════════════════
exports.sendMessage = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ message: "Texto requerido" });

    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: "No encontrada" });

    const callerId = String(req.user._id ?? req.user.id);
    const member   = community.members.find((m) => getMemberId(m) === callerId);
    if (!member) return res.status(403).json({ message: "No sos miembro" });

    if (member.frozen && (member.frozenUntil === "permanent" || new Date(member.frozenUntil) > new Date()))
      return res.status(403).json({ message: "Tu cuenta está congelada en esta comunidad" });

    if (!community.messagingOpen && member.role !== "admin")
      return res.status(403).json({ message: "Mensajes cerrados" });

    const msg = await Message.create({
      roomType: "community",
      roomId:   community._id,
      sender:   req.user._id,
      text:     text.trim(),
    });

    member.msgCount = (member.msgCount ?? 0) + 1;
    await community.save();

    const userDoc = await User.findById(req.user._id, "username avatarUrl profileVideo").lean();

    getIO(req).to(`community:${community._id}`).emit("message:new", {
      id:           String(msg._id),
      type:         "message",
      senderId:     callerId,
      senderName:   userDoc?.username          ?? member.username  ?? "Usuario",
      senderAvatar: userDoc?.avatarUrl         ?? member.avatarUrl ?? null,
      senderVideo:  userDoc?.profileVideo?.url ?? member.profileVideo?.url ?? null,
      senderFrame:  member.frameColor    ?? "none",
      hasStar:      member.hasStar       ?? false,
      isAdmin:      member.role === "admin",
      text:         msg.text,
      createdAt:    msg.createdAt.toISOString(),
    });

    res.status(201).json({ ok: true, message: msg });
  } catch (err) {
    console.error("sendMessage:", err);
    res.status(500).json({ message: "Error" });
  }
};

// ════════════════════════════════════════════════════════════
// Member management helpers
// ════════════════════════════════════════════════════════════
async function findCommunityAndMember(communityId, memberId) {
  const community = await Community.findById(communityId);
  if (!community) return { err: "No encontrada" };
  const member = community.members.find((m) => getMemberId(m) === String(memberId));
  if (!member) return { err: "Miembro no encontrado", community };
  return { community, member };
}

exports.updateMemberRole = async (req, res) => {
  try {
    const { community, member, err } = await findCommunityAndMember(req.params.id, req.params.memberId);
    if (err) return res.status(404).json({ message: err });
    member.role = req.body.role === "admin" ? "admin" : "member";
    await community.save();
    getIO(req).to(`community:${community._id}`).emit("community:member_update", {
      memberId: getMemberId(member), updates: { role: member.role },
    });
    res.json({ role: member.role });
  } catch (e) { res.status(500).json({ message: "Error" }); }
};

exports.addStar = async (req, res) => {
  try {
    const { community, member, err } = await findCommunityAndMember(req.params.id, req.params.memberId);
    if (err) return res.status(404).json({ message: err });
    member.hasStar = true;
    await community.save();
    getIO(req).to(`community:${community._id}`).emit("community:member_update", {
      memberId: getMemberId(member), updates: { hasStar: true },
    });
    res.json({ hasStar: true });
  } catch (e) { res.status(500).json({ message: "Error" }); }
};

exports.removeStar = async (req, res) => {
  try {
    const { community, member, err } = await findCommunityAndMember(req.params.id, req.params.memberId);
    if (err) return res.status(404).json({ message: err });
    member.hasStar = false;
    await community.save();
    getIO(req).to(`community:${community._id}`).emit("community:member_update", {
      memberId: getMemberId(member), updates: { hasStar: false },
    });
    res.json({ hasStar: false });
  } catch (e) { res.status(500).json({ message: "Error" }); }
};

exports.updateFrame = async (req, res) => {
  try {
    const { community, member, err } = await findCommunityAndMember(req.params.id, req.params.memberId);
    if (err) return res.status(404).json({ message: err });
    member.frameColor = req.body.frameColor ?? "none";
    await community.save();
    getIO(req).to(`community:${community._id}`).emit("community:member_update", {
      memberId: getMemberId(member), updates: { frameColor: member.frameColor },
    });
    res.json({ frameColor: member.frameColor });
  } catch (e) { res.status(500).json({ message: "Error" }); }
};

exports.freezeMember = async (req, res) => {
  try {
    const { community, member, err } = await findCommunityAndMember(req.params.id, req.params.memberId);
    if (err) return res.status(404).json({ message: err });
    const days = parseInt(req.body.days ?? "1");
    member.frozen      = true;
    member.frozenUntil = days >= 9999
      ? "permanent"
      : new Date(Date.now() + days * 86400000).toISOString();
    await community.save();
    getIO(req).to(`community:${community._id}`).emit("community:member_update", {
      memberId: getMemberId(member), updates: { frozen: true, frozenUntil: member.frozenUntil },
    });
    res.json({ frozen: true, frozenUntil: member.frozenUntil });
  } catch (e) { res.status(500).json({ message: "Error" }); }
};

exports.unfreezeMember = async (req, res) => {
  try {
    const { community, member, err } = await findCommunityAndMember(req.params.id, req.params.memberId);
    if (err) return res.status(404).json({ message: err });
    member.frozen      = false;
    member.frozenUntil = null;
    await community.save();
    getIO(req).to(`community:${community._id}`).emit("community:member_update", {
      memberId: getMemberId(member), updates: { frozen: false, frozenUntil: null },
    });
    res.json({ frozen: false });
  } catch (e) { res.status(500).json({ message: "Error" }); }
};

exports.shockMember = async (req, res) => {
  try {
    const { community, member, err } = await findCommunityAndMember(req.params.id, req.params.memberId);
    if (err) return res.status(404).json({ message: err });
    getIO(req).to(`user:${getMemberId(member)}`).emit("community:shock", {
      communityId: community._id, communityName: community.name,
    });
    res.json({ message: "Shock enviado" });
  } catch (e) { res.status(500).json({ message: "Error" }); }
};

exports.removeMember = async (req, res) => {
  try {
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: "No encontrada" });
    const before = community.members.length;
    community.members     = community.members.filter((m) => getMemberId(m) !== String(req.params.memberId));
    community.memberCount = community.members.length;
    await community.save();
    if (community.members.length < before) {
      const io = getIO(req);
      io.to(`community:${community._id}`).emit("community:member_removed", { memberId: req.params.memberId });
      io.to(`community:${community._id}`).emit("community:member_count",   { memberCount: community.memberCount });
    }
    res.json({ message: "Miembro eliminado" });
  } catch (e) { res.status(500).json({ message: "Error" }); }
};

// ════════════════════════════════════════════════════════════
// GET /comunidades/:id/members
// FIX v6: populate incluye victorias/derrotas/empates
//         mapeo usa isOnline (campo real del schema User)
// ════════════════════════════════════════════════════════════
exports.getCommunityMembers = async (req, res) => {
  try {
    const community = await Community.findById(req.params.id)
      .populate("members.userId", "username avatarUrl victorias derrotas empates isOnline");
    if (!community) return res.status(404).json({ message: "Comunidad no encontrada" });

    const members = community.members.map((m) => {
      const u = m.userId; // objeto populado (o null si el user fue eliminado)
      const communityRole =
        community.creatorId.toString() === String(u?._id ?? m.userId)
          ? "owner"
          : m.role === "admin"
          ? "admin"
          : "member";

      return {
        _id:          u?._id        ?? m.userId,
        username:     u?.username   ?? m.username  ?? "Usuario",
        avatarUrl:    u?.avatarUrl  ?? m.avatarUrl ?? null,
        // ── stats de batalla ──────────────────────────
        victorias:    u?.victorias  ?? 0,
        derrotas:     u?.derrotas   ?? 0,
        empates:      u?.empates    ?? 0,
        // ─────────────────────────────────────────────
        role:         m.role        ?? "member",
        communityRole,
        online:       u?.isOnline   ?? false,   // campo correcto del schema User
        starred:      m.hasStar     ?? false,
        frozen:       m.frozen      ?? false,
        frozenUntil:  m.frozenUntil ?? null,
        frameColor:   m.frameColor  ?? "none",
        msgCount:     m.msgCount    ?? 0,
        joinedAt:     m.joinedAt,
      };
    });

    res.status(200).json(members);
  } catch (err) {
    console.error("[getCommunityMembers]", err.message);
    res.status(500).json({ message: "Error al obtener miembros" });
  }
};