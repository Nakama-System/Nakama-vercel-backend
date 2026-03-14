const passport       = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const crypto         = require("crypto");
const User           = require("../models/User");
const PreConsent     = require("../models/PreConsent");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      passReqToCallback: true, // necesario para leer req.query.state callbackURL:       "http://localhost:5000/auth/google/callback",
    },
    async (req, _accessToken, _refreshToken, profile, done) => {
      try {
        const email       = profile.emails?.[0]?.value;
        const googleId    = profile.id;
        const avatarUrl   = profile.photos?.[0]?.value || "";
        const displayName = profile.displayName?.replace(/\s+/g, "_").toLowerCase()
                            || `user_${googleId.slice(0, 8)}`;

        // ── Usuario ya existente → login directo, sin pre-consent
        let user = await User.findOne({ $or: [{ googleId }, { email }] });

        if (user) {
          if (!user.googleId) {
            user.googleId = googleId;
            await user.save();
          }
          return done(null, { user, isNewGoogleUser: false });
        }

        // ── Usuario nuevo → verificar pre-consent obligatorio
        const preConsentToken = req.query.state;

        if (!preConsentToken) {
          return done(null, false, { message: "missing_consent" });
        }

        const preConsent = await PreConsent.findById(preConsentToken);

        if (!preConsent || preConsent.used || preConsent.expiresAt < new Date()) {
          return done(null, false, { message: "consent_expired" });
        }

        // Marcar como usado para que no se pueda reutilizar
        preConsent.used = true;
        await preConsent.save();

        // Generar username base desde Google
        let finalUsername = displayName;
        const exists = await User.findOne({ username: displayName });
        if (exists) finalUsername = `${displayName}_${Date.now().toString(36)}`;

        // Crear usuario con legalConsent completo
        user = await User.create({
          googleId,
          email,
          username:           finalUsername,
          avatarUrl:          avatarUrl.replace("=s96-c", "=s400-c"),
          role:               "user",
          isActive:           true,
          onboardingComplete: false,
          legalConsent: {
            birthDate:        preConsent.birthDate,
            parentalConsent:  preConsent.parentalConsent,
            termsAccepted:    preConsent.termsAccepted,
            privacyAccepted:  preConsent.privacyAccepted,
            antiGroomingAck:  preConsent.antiGroomingAck,
            consentTimestamp: preConsent.consentTimestamp,
            consentIp:        preConsent.consentIp,
            userAgent:        preConsent.userAgent,
            termsVersion:     preConsent.termsVersion,
            privacyVersion:   preConsent.privacyVersion,
          },
        });

        return done(null, { user, isNewGoogleUser: true });

      } catch (err) {
        console.error("[passport/google]", err);
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((data, done)   => done(null, data));
passport.deserializeUser((data, done) => done(null, data));
