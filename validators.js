const { body, validationResult } = require('express-validator');

const validateCampaign = [
    body('title').trim().notEmpty().withMessage('Campaign title is required'),
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('goalAmount').isNumeric().withMessage('Goal amount must be a number'),
    
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

module.exports = { validateCampaign };


