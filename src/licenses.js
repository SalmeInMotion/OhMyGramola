/**
 * OhMyGramola — License Taxonomy, Dummy-Proof Explanations & Multi-Filter Helpers
 * Centralizes license classification, YouTube monetization rules, attribution guides,
 * and exclusive AND-based filtering across mixed music libraries.
 */
(function (global) {
  "use strict";

  const LICENSE_DEFS = {
    "cc0": {
      key: "cc0",
      label: "CC0 / Public Domain",
      shortLabel: "CC0 (No Attr.)",
      tone: "safe",
      attributionRequired: false,
      examples: "Jamendo CC0, YouTube Audio Library (Public Domain)",
      summary: "100% free public domain music. No credit required — use it anywhere, even commercially.",
      canDo: [
        "Monetize on YouTube, TikTok, Instagram, Twitch & podcasts",
        "Use in commercial client work, ads, and films",
        "Cut, trim, loop, remix, and sync to video freely"
      ],
      cannotDo: [
        "Cannot claim you composed the original music or register it with Content ID",
        "Cannot re-upload or sell the raw audio file by itself"
      ],
      howToAttribute: "No attribution is legally required! Crediting the artist in your description is optional."
    },
    "royalty-free-no-attr": {
      key: "royalty-free-no-attr",
      label: "Royalty-Free (No Attribution)",
      shortLabel: "RF (No Attr.)",
      tone: "safe",
      attributionRequired: false,
      examples: "StreamBeats (Harris Heller), Pixabay Music, YT Audio Library (No Attribution)",
      summary: "Creator-safe royalty-free music with zero credit required. Built for streamers and YouTubers.",
      canDo: [
        "Monetize on YouTube, Twitch, and social media without DMCA strikes",
        "Use in commercial & client video edits",
        "Edit, trim, loop, and mix with voiceovers/SFX"
      ],
      cannotDo: [
        "Cannot redistribute or resell the standalone audio file as stock music",
        "Cannot claim exclusive copyright or register it in Content ID"
      ],
      howToAttribute: "No attribution required. You can drop it straight into your timeline."
    },
    "cc-by": {
      key: "cc-by",
      label: "CC BY (Attribution Required)",
      shortLabel: "CC BY (Credit)",
      tone: "attr",
      attributionRequired: true,
      examples: "Kevin MacLeod (Incompetech CC BY 4.0), Jamendo CC BY, YT Audio Library (CC BY)",
      summary: "100% free for YouTube & commercial videos — you just need to paste the credit in your description.",
      canDo: [
        "Monetize on YouTube and use in commercial client projects",
        "Cut, trim, loop, and sync with any video",
        "Use worldwide forever once properly credited"
      ],
      cannotDo: [
        "MUST include the attribution credit (missing credit = license violation)",
        "Cannot claim you created the music or register it with Content ID",
        "Cannot resell the raw unedited audio track by itself"
      ],
      howToAttribute: "Copy the exact attribution text below and paste it into your YouTube video description (or end credits)."
    },
    "royalty-free-attr": {
      key: "royalty-free-attr",
      label: "Royalty-Free (Attribution)",
      shortLabel: "RF (Credit)",
      tone: "attr",
      attributionRequired: true,
      examples: "CreatorMix, Free-to-use creator catalogs requiring a credit line",
      summary: "Free to monetize on YouTube and social media when you include a short credit line in your description.",
      canDo: [
        "Monetize on YouTube and social platforms safely",
        "Trim, loop, and sync to client or personal videos"
      ],
      cannotDo: [
        "Must include the source/artist credit in your video description",
        "Cannot re-upload or sell the standalone music track"
      ],
      howToAttribute: "Paste the credit text below into your video description."
    },
    "cc-by-sa": {
      key: "cc-by-sa",
      label: "CC BY-SA (ShareAlike)",
      shortLabel: "CC BY-SA",
      tone: "sharealike",
      attributionRequired: true,
      examples: "Jamendo CC BY-SA tracks",
      summary: "Free for YouTube & commercial use with credit. If you release an audio remix, it must share the same license.",
      canDo: [
        "Use and monetize in YouTube videos and commercial projects with credit",
        "Trim, loop, and edit to fit your video timeline"
      ],
      cannotDo: [
        "MUST credit the original artist in your description",
        "If you distribute a standalone audio remix/derivative song, it must also use CC BY-SA",
        "Cannot claim ownership or register with Content ID"
      ],
      howToAttribute: "Copy the attribution credit below (including the CC BY-SA link) into your video description."
    },
    "local-preverified": {
      key: "local-preverified",
      label: "Local / Pre-verified",
      shortLabel: "Local / Unspecified",
      tone: "neutral",
      attributionRequired: false,
      examples: "Local audio files without an embedded ID3 license tag",
      summary: "Local audio file on your drive with no specific license tag embedded yet.",
      canDo: [
        "Ready to preview, trim, and import into After Effects immediately"
      ],
      cannotDo: [
        "Verify the original download source before monetizing if no license tag is embedded"
      ],
      howToAttribute: "Check the folder name or embedded metadata; if it came from a CC-BY source, include the artist credit."
    }
  };

  const LICENSE_ORDER = [
    "cc0",
    "royalty-free-no-attr",
    "cc-by",
    "royalty-free-attr",
    "cc-by-sa",
    "local-preverified"
  ];

  const SUGGESTED_FILTERS = [
    // License quick chips
    { type: "license", value: "cc-by", label: "License: CC BY", group: "License" },
    { type: "license", value: "cc0", label: "License: CC0", group: "License" },
    { type: "license", value: "royalty-free-no-attr", label: "License: RF (No Credit)", group: "License" },
    { type: "license", value: "royalty-free-attr", label: "License: RF (Credit)", group: "License" },
    { type: "license", value: "cc-by-sa", label: "License: CC BY-SA", group: "License" },
    // Instruments & tags
    { type: "tag", value: "drums", label: "drums", group: "Instrument" },
    { type: "tag", value: "piano", label: "piano", group: "Instrument" },
    { type: "tag", value: "guitar", label: "guitar", group: "Instrument" },
    { type: "tag", value: "synth", label: "synth", group: "Instrument" },
    { type: "tag", value: "percussion", label: "percussion", group: "Instrument" },
    { type: "tag", value: "bass", label: "bass", group: "Instrument" },
    // Mood / Style
    { type: "tag", value: "cinematic", label: "cinematic", group: "Mood / Style" },
    { type: "tag", value: "upbeat", label: "upbeat", group: "Mood / Style" },
    { type: "tag", value: "epic", label: "epic", group: "Mood / Style" },
    { type: "tag", value: "ambient", label: "ambient", group: "Mood / Style" },
    { type: "tag", value: "dark", label: "dark", group: "Mood / Style" },
    { type: "tag", value: "lofi", label: "lofi", group: "Mood / Style" },
    { type: "tag", value: "electronic", label: "electronic", group: "Mood / Style" },
    { type: "tag", value: "grooving", label: "grooving", group: "Mood / Style" }
  ];

  function classifyTrackLicense(track) {
    if (!track) return "local-preverified";
    const raw = String(track.licenseType || "").toLowerCase();
    const attr = String(track.attribution || "").toLowerCase();
    const src = String(track.sourceLabel || track.source || "").toLowerCase();

    if (raw.includes("by-sa") || raw.includes("sharealike")) {
      return "cc-by-sa";
    }
    if (raw.includes("cc0") || raw.includes("public domain") || raw.includes("cc-0")) {
      return "cc0";
    }
    if (raw.includes("cc by") || raw.includes("cc-by") || raw.includes("by 4.0") || raw.includes("by 3.0") || raw.includes("attribution 4.0")) {
      return "cc-by";
    }
    if (raw.includes("no attribution") || raw.includes("no-attribution") || raw.includes("streambeats") || raw.includes("pixabay")) {
      return "royalty-free-no-attr";
    }
    if (src.includes("streambeats") || src.includes("pixabay")) {
      return "royalty-free-no-attr";
    }
    if (raw.includes("creatormix") || src.includes("creatormix")) {
      return "royalty-free-attr";
    }
    if (raw.includes("royalty-free") || raw.includes("royalty free")) {
      if (raw.includes("attribution") || attr.includes("credit") || attr.includes("music by")) {
        return "royalty-free-attr";
      }
      return "royalty-free-no-attr";
    }
    if (raw.includes("creative commons")) {
      return "cc-by";
    }
    return "local-preverified";
  }

  function matchesLicenseFilter(track, selectedLicense) {
    if (!selectedLicense) return true;
    const key = classifyTrackLicense(track);
    if (selectedLicense === "no-attribution") {
      return key === "cc0" || key === "royalty-free-no-attr";
    }
    if (selectedLicense === "attribution-required") {
      return key === "cc-by" || key === "royalty-free-attr" || key === "cc-by-sa";
    }
    return key === selectedLicense;
  }

  function buildTrackSearchBlob(track) {
    if (!track) return "";
    if (track._fullSearchBlob) return track._fullSearchBlob;
    const key = classifyTrackLicense(track);
    const def = LICENSE_DEFS[key];
    const blob = [
      track._searchBlob || "",
      track.title || "",
      track.artist || "",
      track.genre || "",
      track.instruments || "",
      track.feel || "",
      track.description || "",
      track.bpm && track.bpm !== "—" ? `${track.bpm} ${track.bpm}bpm` : "",
      track.sourceLabel || track.source || "",
      track.licenseType || "",
      def ? `${def.label} ${def.shortLabel} ${def.key}` : "",
      track.attribution || ""
    ].join(" ").toLowerCase();
    track._fullSearchBlob = blob;
    return blob;
  }

  function matchesTrackAllCriteria(track, { query = "", genre = "", license = "", tags = [] } = {}) {
    if (!track) return false;
    if (license && !matchesLicenseFilter(track, license)) {
      return false;
    }
    if (genre && String(track.genre || "").toLowerCase() !== genre.toLowerCase().trim()) {
      return false;
    }
    const tokens = [
      ...String(query || "").toLowerCase().trim().split(/\s+/).filter(Boolean),
      ...(Array.isArray(tags) ? tags.map((t) => String(t || "").toLowerCase().trim()).filter(Boolean) : [])
    ];
    if (tokens.length > 0) {
      const blob = buildTrackSearchBlob(track);
      for (let i = 0; i < tokens.length; i++) {
        if (!blob.includes(tokens[i])) return false;
      }
    }
    return true;
  }

  function explainTrackLicense(track) {
    const key = classifyTrackLicense(track);
    const def = LICENSE_DEFS[key] || LICENSE_DEFS["local-preverified"];
    return {
      key,
      rawLicense: (track && track.licenseType) || def.label,
      title: (track && track.title) || "Track",
      artist: (track && track.artist) || "Unknown Artist",
      attributionText: (track && track.attribution) || "",
      ...def
    };
  }

  function getFilterOptions() {
    return LICENSE_ORDER.map((k) => ({
      value: LICENSE_DEFS[k].key,
      label: LICENSE_DEFS[k].label
    }));
  }

  function getAllLicensesOverview() {
    return LICENSE_ORDER.map((k) => LICENSE_DEFS[k]);
  }

  function getSuggestedFilters() {
    return SUGGESTED_FILTERS.slice();
  }

  global.LicenseGuide = {
    LICENSE_DEFS,
    classifyTrackLicense,
    matchesLicenseFilter,
    matchesTrackAllCriteria,
    explainTrackLicense,
    getFilterOptions,
    getAllLicensesOverview,
    getSuggestedFilters
  };
})(window);
