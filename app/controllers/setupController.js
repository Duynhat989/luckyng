const { STATUS, Setup } = require("../models");
const { encryption, compare } = require('../utils/encode');
const { invalidateSetup } = require("../services/setupCache.service");

// Lấy danh sách tất cả học sinh
exports.getAllSetup = async (req, res) => {
    try {
        const setups = await Setup.findAll({
            where: { status: STATUS.ON },
            order: [["createdAt", "DESC"]],
        });
        res.status(200).json({
            success: true,
            data: setups
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
exports.saveAllSetup = async (req, res) => {
    try {
        const { API_KEY,
            API_STATUS,
            API_ESTATE,
            API_FINANCEAL,
            API_SUMMARY,
            API_TEAMTRAINING,
            API_REP_CONTRACT,
            API_INVESTADVISE,
            API_FREE_UP,
            API_PAYMENT_MONTHS
        } = req.body
        if (API_KEY) {
            await Setup.upsert({
                name: 'API_KEY',
                value: API_KEY,
                notify:"111"
            });

        }
        if (API_STATUS) {
            const item = await Setup.findOne({
                where: {
                    name: 'API_STATUS'
                }
            })
            if (item) {
                item.value = API_STATUS
                await item.save();
            }
        }
        if (API_ESTATE) {
            const item = await Setup.findOne({
                where: {
                    name: 'API_ESTATE'
                }
            })
            if (item) {
                item.value = API_ESTATE
                await item.save();
            }
        }
        if (API_FINANCEAL) {
            const item = await Setup.findOne({
                where: {
                    name: 'API_FINANCEAL'
                }
            })
            if (item) {
                item.value = API_FINANCEAL
                await item.save();
            }
        }
        if (API_SUMMARY) {
            const item = await Setup.findOne({
                where: {
                    name: 'API_SUMMARY'
                }
            })
            if (item) {
                item.value = API_SUMMARY
                await item.save();
            }
        }
        if (API_TEAMTRAINING) {
            const item = await Setup.findOne({
                where: {
                    name: 'API_TEAMTRAINING'
                }
            })
            if (item) {
                item.value = API_TEAMTRAINING
                await item.save();
            }
        }
        if (API_REP_CONTRACT) {
            const item = await Setup.findOne({
                where: {
                    name: 'API_REP_CONTRACT'
                }
            })
            if (item) {
                item.value = API_REP_CONTRACT
                await item.save();
            }
        }
        if (API_INVESTADVISE) {
            const item = await Setup.findOne({
                where: {
                    name: 'API_INVESTADVISE'
                }
            })
            if (item) {
                item.value = API_INVESTADVISE
                await item.save();
            }
        }
        if (API_FREE_UP) {
            const item = await Setup.findOne({
                where: {
                    name: 'API_FREE_UP'
                }
            })
            if (item) {
                item.value = API_FREE_UP
                await item.save();
            }
        }
        if (API_PAYMENT_MONTHS) {
            const item = await Setup.findOne({
                where: {
                    name: 'API_PAYMENT_MONTHS'
                }
            })
            if (item) {
                item.value = API_PAYMENT_MONTHS
                await item.save();
            } else {
                await Setup.create({
                    name: 'API_PAYMENT_MONTHS',
                    value: API_PAYMENT_MONTHS,
                    notify: "111"
                });
            }
        }
        invalidateSetup();
        res.status(200).json({
            success: true
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
exports.getStatus = async (req, res) => {
    try {
        const setups = await Setup.findOne({
            where: {
                status: STATUS.ON,
                name: 'API_STATUS'
            }
        });
        res.status(200).json({
            maintenance: parseInt(setups.value) != 0 ? true : false
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
exports.getPayment = async (req, res) => {
    try {
        const setups = await Setup.findOne({
            where: {
                status: STATUS.ON,
                name: 'API_PAYMENT_MONTHS'
            }
        });
        res.status(200).json({
            payment: setups
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};