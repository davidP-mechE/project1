# Course packets

- `coursebook_sat_math_course.json`, `coursebook_sat_rw_course.json`: the SAT Math and Reading and Writing
  Master Courses (format `coursebook-course-packet`, version 1). Committed.
- `coursebook_sat_question_bank.json` and `qbank_images/` (4,720 WebP files): the College Board
  Question Bank items the courses' practice sets use. **Not committed** (see `.gitignore`): keep them
  locally, in-house only.

Import, in this order (both are safe to run again; add `-- --dry-run` to check first):

```bash
npm run import:bank
npm run import:courses
```

The bank goes into the question bank as in-house content (images to private storage); the courses
come in as Course Studio drafts that only the owner sees. See ADMIN_GUIDE.md, "SAT Master Courses".
