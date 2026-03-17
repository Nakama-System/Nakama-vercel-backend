// utils/formatUser.js
function formatUser(user) {
  return {
    id:                      user._id,
    username:                user.username,
    email:                   user.email,
    role:                    user.role,
    avatarUrl:               user.avatarUrl,
    profileVideo:            user.profileVideo,
    interests:               user.interests,
    bio:                     user.bio,
    displayName:             user.displayName,
    rank:                    user.rank,
    followersCount:          user.followersCount,
    followingCount:          user.followingCount,
    isOnline:                user.isOnline,
    subscription:            user.subscription,
    acceptedTermsVersion:    user.acceptedTermsVersion,
    acceptedPrivacyVersion:  user.acceptedPrivacyVersion,
    pendingTermsAcceptance:  user.pendingTermsAcceptance,
    monthlyVideoLimit:       user.monthlyVideoLimit,
    monthlyVideoRemaining:   user.monthlyVideoRemaining,
    canCreateComunidad:      user.canCreateComunidad,
    canToggleRoomVisibility: user.canToggleRoomVisibility,
    onboardingComplete:      user.onboardingComplete,
    createdAt:               user.createdAt,
    victorias:               user.victorias ?? 0,
    derrotas:                user.derrotas  ?? 0,
    empates:                 user.empates   ?? 0,
  };
}

module.exports = formatUser;