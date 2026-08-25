//! What the window is showing, and the re-read that keeps it current.
//!
//! The snapshot lives here rather than in the UI, which is what lets a change be
//! answered with a diff: this side already knows what the window has, so it
//! re-reads only the repositories a change could have touched. Nothing here
//! knows about Tauri.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::super::delta::{self, WorkspaceDelta};
use super::super::inspect::{Located, id_of};
use super::super::model::{Repository, Workspace};

/// What the UI is showing, and everything needed to re-read it.
pub(crate) struct Session {
    root: PathBuf,
    commit_limit: usize,
    /// In display order, exactly as the UI has them.
    repositories: Vec<Repository>,
    /// Where each repository lives, by id. Ordered, so a refresh produces its
    /// warnings in a stable order rather than reporting a diff that is only
    /// the iteration order changing.
    located: BTreeMap<String, Located>,
    /// Every directory the walk has already resolved, so a re-survey skips
    /// `locate` for the ones that have not moved.
    candidates: HashMap<PathBuf, Located>,
    /// Problems from the walk itself, kept apart from inspection failures
    /// because a partial refresh does not re-walk.
    survey_warnings: Vec<String>,
    /// The warning list the UI has, which is the two kinds concatenated.
    warnings: Vec<String>,
}

impl Session {
    /// Scans `root` and becomes the snapshot every later refresh diffs against.
    pub fn open(root: &str, commit_limit: Option<usize>) -> Result<Self, String> {
        let root = super::super::scan::normalize_root(root)?;
        let commit_limit = super::super::scan::clamp_commit_limit(commit_limit);

        let survey = super::super::scan::survey(&root, &HashMap::new());
        let located = index(&survey.repositories);
        let (mut repositories, failures) =
            super::super::scan::inspect_all(survey.repositories, commit_limit);
        super::super::scan::sort_repositories(&mut repositories);

        let mut warnings = survey.warnings.clone();
        warnings.extend(failures);

        Ok(Self {
            root,
            commit_limit,
            repositories,
            located,
            candidates: survey.candidates,
            survey_warnings: survey.warnings,
            warnings,
        })
    }

    pub fn root(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    /// The whole snapshot, for the window that is about to draw it for the
    /// first time.
    pub fn workspace(&self) -> Workspace {
        Workspace {
            root: self.root(),
            repositories: self.repositories.clone(),
            warnings: self.warnings.clone(),
        }
    }

    pub fn git_dirs(&self) -> Vec<String> {
        self.repositories
            .iter()
            .map(|repository| repository.git_dir.clone())
            .collect()
    }

    pub fn paths(&self) -> Vec<String> {
        self.repositories
            .iter()
            .map(|repository| repository.path.clone())
            .collect()
    }

    /// Re-reads what `touched` could have changed — everything, when it is
    /// `None` — and returns the diff against the snapshot, which it replaces.
    pub fn refresh(&mut self, touched: Option<&[PathBuf]>) -> Result<WorkspaceDelta, String> {
        let plan = self.plan(touched);

        let mut survey_warnings = self.survey_warnings.clone();
        let mut located = self.located.clone();
        if plan.rediscover {
            if !crate::host::Host::of(&self.root).is_dir(&self.root) {
                return Err("not-a-directory".to_string());
            }
            let survey = super::super::scan::survey(&self.root, &self.candidates);
            located = index(&survey.repositories);
            survey_warnings = survey.warnings;
            self.candidates = survey.candidates;
        }

        // A repository is re-read when a change pointed at it or when it is
        // new; everything else is carried over untouched, which is what keeps
        // a commit in one repository from costing a read of the other twenty.
        let mut carried: Vec<Repository> = Vec::new();
        let mut stale: Vec<Located> = Vec::new();
        for (id, entry) in &located {
            match self.repository(id) {
                Some(repository) if !plan.targets.contains(id) => carried.push(repository.clone()),
                _ => stale.push(entry.clone()),
            }
        }

        let (inspected, failures) = super::super::scan::inspect_all(stale, self.commit_limit);
        let mut repositories = carried;
        repositories.extend(inspected);
        super::super::scan::sort_repositories(&mut repositories);

        let mut warnings = survey_warnings.clone();
        warnings.extend(failures);

        let changed = delta::diff_workspace(
            &self.root(),
            &self.repositories,
            &self.warnings,
            &repositories,
            &warnings,
        );

        self.repositories = repositories;
        self.located = located;
        self.survey_warnings = survey_warnings;
        self.warnings = warnings;

        Ok(changed)
    }

    /// Where to run git for one repository: its own working directory.
    pub(super) fn repository_dir(&self, id: &str) -> Option<PathBuf> {
        self.located.get(id).map(|located| located.path.clone())
    }

    fn repository(&self, id: &str) -> Option<&Repository> {
        self.repositories
            .iter()
            .find(|repository| repository.id == id)
    }

    fn plan(&self, touched: Option<&[PathBuf]>) -> Plan {
        let Some(touched) = touched else {
            // An explicit refresh trusts nothing it already has.
            return Plan {
                rediscover: true,
                targets: self.located.keys().cloned().collect(),
            };
        };

        let mut plan = Plan {
            rediscover: false,
            targets: HashSet::new(),
        };
        for path in touched {
            match self.owner(path) {
                Some(id) => {
                    plan.targets.insert(id);
                }
                // A path under no repository we know about is the tree itself
                // moving: a clone landed, a folder was removed.
                None => plan.rediscover = true,
            }
        }
        plan
    }

    /// The repository a changed path belongs to.
    ///
    /// Repositories nest — a submodule sits inside its parent's worktree — so
    /// the innermost match is the one that changed, and matching is by whole
    /// path components: `alpha-feature` is not inside `alpha`.
    fn owner(&self, path: &Path) -> Option<String> {
        self.located
            .iter()
            .filter_map(|(id, located)| {
                let depth = [&located.common_dir, &located.path]
                    .into_iter()
                    .filter(|root| path.starts_with(root))
                    .map(|root| root.components().count())
                    .max()?;
                Some((depth, id))
            })
            .max_by_key(|(depth, _)| *depth)
            .map(|(_, id)| id.clone())
    }
}

/// What a change is worth re-reading.
struct Plan {
    /// The tree itself moved, so the walk has to run again.
    rediscover: bool,
    /// Repositories a change could have touched.
    targets: HashSet<String>,
}

fn index(located: &[Located]) -> BTreeMap<String, Located> {
    located
        .iter()
        .map(|entry| (id_of(entry), entry.clone()))
        .collect()
}
